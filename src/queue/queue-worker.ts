/**
 * Queue Worker
 * Polls the event queue and processes events through the workflow engine
 */

import { logger } from '../persistence/logger.js';
import { getDatabase } from '../persistence/database.js';
import { WorkflowEngine } from '../core/workflow-engine.js';
import type { ProcessedEvent } from '../inbound/nostr-listener.js';
import type { QueuedEvent, QueuedEventType, QueuedEventStatus } from '../persistence/models/queued-event.js';

export interface QueueWorkerConfig {
  // Polling interval in milliseconds (default: 1000ms)
  pollIntervalMs?: number;
  // Maximum concurrent events to process (default: 1)
  concurrency?: number;
  // Reset events stuck in 'processing' state for more than this many minutes (default: 10)
  stuckTimeoutMinutes?: number;
  // Cleanup completed events older than this many days (default: 7)
  cleanupDays?: number;
  // Run cleanup every N poll cycles (default: 100)
  cleanupInterval?: number;
  // Whether to process events (can be disabled for read-only mode)
  enabled?: boolean;
}

export interface QueuedEventData {
  // For nostr_event and nostr_dm types
  nostrEvent?: ProcessedEvent;
  // For api_webhook type
  webhookEvent?: {
    id: string;
    webhookId: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body: unknown;
    timestamp: number;
  };
  // For hook type (triggered from workflow hooks)
  hookEvent?: {
    hookType: 'on_start' | 'on_complete' | 'on_fail';
    parentWorkflowId: string;
    parentWorkflowName: string;
    targetWorkflowId: string;
    triggerContext: unknown;
    matchGroups: Record<string, string>;
    parentInfo: {
      id: string;
      name: string;
      success: boolean;
      actionsExecuted: number;
      actionsFailed: number;
      actionsSkipped: number;
      error?: string | undefined;
    };
  };
  // For manual type (replayed or manually added)
  manualEvent?: {
    originalEventId?: string | undefined;
    data: unknown;
  };
  // For internal_poll type (scheduled background jobs)
  pollEvent?: {
    pollType: string;           // e.g., 'address_monitor'
    address?: string;           // Bitcoin address to monitor
    target_pubkey?: string;     // Who to notify
    dm_format?: 'nip04' | 'nip17';  // DM format for notifications (propagated from trigger)
    data?: Record<string, unknown>;  // Additional context data
    created_at: number;         // Timestamp when poll was scheduled
  };
}

export class QueueWorker {
  private config: Required<QueueWorkerConfig>;
  private workflowEngine: WorkflowEngine;
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollCount = 0;
  private activeProcessing = 0;

  constructor(workflowEngine: WorkflowEngine, config: QueueWorkerConfig = {}) {
    this.workflowEngine = workflowEngine;
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      concurrency: config.concurrency ?? 1,
      stuckTimeoutMinutes: config.stuckTimeoutMinutes ?? 10,
      cleanupDays: config.cleanupDays ?? 7,
      cleanupInterval: config.cleanupInterval ?? 100,
      enabled: config.enabled ?? true,
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Queue worker already running');
      return;
    }

    if (!this.config.enabled) {
      logger.info('Queue worker disabled');
      return;
    }

    this.running = true;
    logger.info({ config: this.config }, 'Queue worker starting');

    // Reset any stuck events from previous runs
    const db = getDatabase();
    const resetCount = db.resetStuckEvents(this.config.stuckTimeoutMinutes);
    if (resetCount > 0) {
      logger.info({ count: resetCount }, 'Reset stuck events from previous run');
    }

    // Start polling
    this.poll();
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for active processing to complete
    while (this.activeProcessing > 0) {
      logger.info({ active: this.activeProcessing }, 'Waiting for active processing to complete');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info('Queue worker stopped');
  }

  private async poll(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      // Process events up to concurrency limit
      while (this.running && this.activeProcessing < this.config.concurrency) {
        const db = getDatabase();
        const event = db.dequeueEvent();

        if (!event) {
          break; // No more events to process
        }

        this.activeProcessing++;
        this.processQueuedEvent(event)
          .catch((error) => {
            logger.error({ eventId: event.id, error }, 'Unexpected error processing queued event');
          })
          .finally(() => {
            this.activeProcessing--;
          });
      }

      // Periodic cleanup
      this.pollCount++;
      if (this.pollCount >= this.config.cleanupInterval) {
        this.pollCount = 0;
        this.runCleanup();
      }
    } catch (error) {
      logger.error({ error }, 'Error in queue poll cycle');
    }

    // Schedule next poll
    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), this.config.pollIntervalMs);
    }
  }

  private async processQueuedEvent(queuedEvent: QueuedEvent): Promise<void> {
    const startTime = Date.now();
    const db = getDatabase();

    logger.debug(
      {
        queueId: queuedEvent.id,
        eventType: queuedEvent.event_type,
        retryCount: queuedEvent.retry_count,
      },
      'Processing queued event'
    );

    try {
      // Parse the event data
      const eventData: QueuedEventData = JSON.parse(queuedEvent.event_data);

      // Get the ProcessedEvent to process
      let processedEvent: ProcessedEvent;
      switch (queuedEvent.event_type) {
        case 'nostr_dm':
        case 'nostr_event':
          if (eventData.nostrEvent) {
            processedEvent = eventData.nostrEvent;
          } else {
            throw new Error('Missing nostrEvent data');
          }
          break;

        case 'api_webhook':
          if (eventData.webhookEvent) {
            processedEvent = this.convertWebhookToProcessedEvent(eventData.webhookEvent);
          } else {
            throw new Error('Missing webhookEvent data');
          }
          break;

        case 'manual':
          if (eventData.nostrEvent) {
            processedEvent = eventData.nostrEvent;
          } else if (eventData.manualEvent?.data) {
            processedEvent = eventData.manualEvent.data as ProcessedEvent;
          } else {
            throw new Error('Missing manual event data');
          }
          break;

        case 'internal_poll':
          if (eventData.pollEvent) {
            processedEvent = this.convertPollToProcessedEvent(eventData.pollEvent);
          } else {
            throw new Error('Missing pollEvent data');
          }
          break;

        default:
          throw new Error(`Unknown event type: ${queuedEvent.event_type}`);
      }

      // Process with detailed match info
      const { status, results, disabledMatches } = await this.workflowEngine.processEventWithMatchInfo(processedEvent);

      // Handle based on match status
      if (status === WorkflowEngine.MATCH_STATUS.NO_MATCH) {
        // No workflow matched at all
        db.markEventStatus(queuedEvent.id, 'no_match', undefined, undefined, { noMatch: true });
        logger.debug(
          { queueId: queuedEvent.id, duration: Date.now() - startTime },
          'Queued event: no workflow matched'
        );
      } else if (status === WorkflowEngine.MATCH_STATUS.ALL_DISABLED) {
        // Workflows matched but all disabled - record the first disabled workflow
        const firstDisabled = disabledMatches[0];
        db.markEventStatus(
          queuedEvent.id,
          'skipped_disabled',
          firstDisabled?.workflowId,
          firstDisabled?.workflowName,
          { disabledMatches }
        );
        logger.info(
          {
            queueId: queuedEvent.id,
            disabledWorkflows: disabledMatches.map((m) => m.workflowId),
            duration: Date.now() - startTime,
          },
          'Queued event: matched workflows are disabled'
        );
      } else {
        // Workflows executed
        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;

        if (failCount === 0 && results.length > 0) {
          // All workflows succeeded
          const firstResult = results[0]!;
          db.ackEvent(
            queuedEvent.id,
            firstResult.workflowId,
            firstResult.workflowName,
            {
              successCount,
              results: results.map((r) => ({
                workflowId: r.workflowId,
                success: r.success,
                actionsExecuted: r.actionsExecuted,
              })),
              disabledMatches: disabledMatches.length > 0 ? disabledMatches : undefined,
            }
          );
          logger.info(
            {
              queueId: queuedEvent.id,
              workflowId: firstResult.workflowId,
              successCount,
              duration: Date.now() - startTime,
            },
            'Queued event completed successfully'
          );
        } else {
          // Some workflows failed
          const errorMessages = results
            .filter((r) => !r.success)
            .map((r) => `${r.workflowId}: ${r.error}`)
            .join('; ');

          db.nackEvent(queuedEvent.id, errorMessages, true);
          logger.warn(
            {
              queueId: queuedEvent.id,
              failCount,
              successCount,
              errors: errorMessages,
              duration: Date.now() - startTime,
            },
            'Queued event partially failed'
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      db.nackEvent(queuedEvent.id, errorMessage, true);
      logger.error(
        {
          queueId: queuedEvent.id,
          error: errorMessage,
          retryCount: queuedEvent.retry_count,
          duration: Date.now() - startTime,
        },
        'Queued event processing failed'
      );
    }
  }

  private convertWebhookToProcessedEvent(webhook: NonNullable<QueuedEventData['webhookEvent']>): ProcessedEvent {
    const content = JSON.stringify(webhook.body);
    return {
      id: webhook.id,
      pubkey: 'webhook',
      pubkeyNpub: 'webhook',
      kind: 20000, // Custom kind for webhooks
      created_at: Math.floor(webhook.timestamp / 1000),
      tags: [
        ['source', 'webhook'],
        ['webhook_id', webhook.webhookId],
        ['method', webhook.method],
        ['path', webhook.path],
      ],
      sig: '',
      rawContent: content,
      decryptedContent: content,
      encryptionType: 'none',
      isEncrypted: false,
      isFromWhitelist: true,
      relayUrl: 'webhook',
    };
  }

  private convertPollToProcessedEvent(poll: NonNullable<QueuedEventData['pollEvent']>): ProcessedEvent {
    // Build content from poll data for workflow matching
    const content = JSON.stringify({
      poll_type: poll.pollType,
      address: poll.address,
      target_pubkey: poll.target_pubkey,
      ...poll.data,
    });

    return {
      id: `poll-${poll.pollType}-${poll.address ?? 'unknown'}-${poll.created_at}`,
      pubkey: 'internal_poll',
      pubkeyNpub: 'internal_poll',
      kind: 20001, // Custom kind for internal polls
      created_at: Math.floor(poll.created_at / 1000),
      tags: [
        ['source', 'internal_poll'],
        ['poll_type', poll.pollType],
        ...(poll.address ? [['address', poll.address]] : []),
        ...(poll.target_pubkey ? [['target_pubkey', poll.target_pubkey]] : []),
        ...(poll.dm_format ? [['dm_format', poll.dm_format]] : []),
      ],
      sig: '',
      rawContent: content,
      decryptedContent: content,
      encryptionType: 'none',
      isEncrypted: false,
      isFromWhitelist: true,
      relayUrl: 'internal',
    };
  }

  private runCleanup(): void {
    try {
      const db = getDatabase();

      // Cleanup old completed events
      const cleanedCount = db.cleanupQueue(this.config.cleanupDays);
      if (cleanedCount > 0) {
        logger.info({ count: cleanedCount, days: this.config.cleanupDays }, 'Cleaned up old queue entries');
      }

      // Reset stuck events
      const resetCount = db.resetStuckEvents(this.config.stuckTimeoutMinutes);
      if (resetCount > 0) {
        logger.warn({ count: resetCount }, 'Reset stuck events');
      }
    } catch (error) {
      logger.error({ error }, 'Error during queue cleanup');
    }
  }

  // Get current queue statistics
  getStats(): {
    running: boolean;
    activeProcessing: number;
    config: QueueWorkerConfig;
  } {
    return {
      running: this.running,
      activeProcessing: this.activeProcessing,
      config: this.config,
    };
  }
}

// Helper function to enqueue a Nostr event
export function enqueueNostrEvent(
  event: ProcessedEvent,
  options?: { priority?: number; maxRetries?: number }
): number {
  const db = getDatabase();
  const eventType: QueuedEventType = event.kind === 4 ? 'nostr_dm' : 'nostr_event';
  const eventData: QueuedEventData = { nostrEvent: event };

  return db.enqueueEvent(eventType, eventData, event.id, {
    priority: options?.priority ?? 0,
    max_retries: options?.maxRetries ?? 3,
  });
}

// Helper function to enqueue a webhook event
export function enqueueWebhookEvent(
  webhook: NonNullable<QueuedEventData['webhookEvent']>,
  options?: { priority?: number; maxRetries?: number }
): number {
  const db = getDatabase();
  const eventData: QueuedEventData = { webhookEvent: webhook };

  return db.enqueueEvent('api_webhook', eventData, webhook.id, {
    priority: options?.priority ?? 0,
    max_retries: options?.maxRetries ?? 3,
  });
}

// Helper function to manually enqueue an event for replay
export function enqueueManualEvent(
  data: unknown,
  originalEventId?: string,
  options?: { priority?: number; maxRetries?: number }
): number {
  const db = getDatabase();
  const eventData: QueuedEventData = {
    manualEvent: {
      originalEventId,
      data,
    },
  };

  return db.enqueueEvent('manual', eventData, originalEventId, {
    priority: options?.priority ?? 0,
    max_retries: options?.maxRetries ?? 3,
  });
}

// Helper function to enqueue an internal poll event (for scheduled background jobs)
export function enqueuePollEvent(
  pollType: string,
  options: {
    address?: string;
    target_pubkey?: string;
    dm_format?: 'nip04' | 'nip17';
    data?: Record<string, unknown>;
    delay_ms?: number;
    priority?: number;
    maxRetries?: number;
  } = {}
): number {
  const db = getDatabase();
  const now = Date.now();

  // Build pollEvent object, only including defined properties
  const pollEvent: {
    pollType: string;
    address?: string;
    target_pubkey?: string;
    dm_format?: 'nip04' | 'nip17';
    data?: Record<string, unknown>;
    created_at: number;
  } = {
    pollType,
    created_at: now,
  };
  if (options.address) pollEvent.address = options.address;
  if (options.target_pubkey) pollEvent.target_pubkey = options.target_pubkey;
  if (options.dm_format) pollEvent.dm_format = options.dm_format;
  if (options.data) pollEvent.data = options.data;

  const eventData: QueuedEventData = { pollEvent };

  const eventId = `poll-${pollType}-${options.address ?? 'unknown'}-${now}`;

  // Build enqueue options, only including defined delay_ms
  const enqueueOptions: { priority: number; max_retries: number; delay_ms?: number } = {
    priority: options.priority ?? 0,
    max_retries: options.maxRetries ?? 3,
  };
  if (options.delay_ms !== undefined) enqueueOptions.delay_ms = options.delay_ms;

  return db.enqueueEvent('internal_poll', eventData, eventId, enqueueOptions);
}

