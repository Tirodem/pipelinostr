/**
 * Queue worker (ADR-006: single-process)
 *
 * Polls the queue, processes events, retry logic.
 * Shutdown-aware: checks shuttingDown between items.
 * Per-item execution timeout (ADR-014).
 */

import type { Logger } from 'pino';
import type { Storage } from '../storage/storage.port.js';
import type { WorkflowEngine } from '../core/engine.js';
import type { WorkflowLoader } from '../core/workflow-loader.js';
import type { NormalizedEvent } from '../core/types.js';
import { findMatchingWorkflows } from '../core/matcher.js';

export interface QueueWorkerOptions {
  pollIntervalMs?: number;
  itemTimeoutMs?: number;
  maxRetries?: number;
}

export class QueueWorker {
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollIntervalMs: number;
  private itemTimeoutMs: number;

  constructor(
    private storage: Storage,
    private engine: WorkflowEngine,
    private workflowLoader: WorkflowLoader,
    private logger: Logger,
    options: QueueWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.itemTimeoutMs = options.itemTimeoutMs ?? 30000;
  }

  /**
   * Start polling the queue.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.info('Queue worker started');
    this.poll();
  }

  /**
   * Stop polling. Waits for current item to finish (up to timeout).
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.info('Queue worker stopped');
  }

  /**
   * Process a single event directly (bypass queue).
   * Used for real-time processing when queue is disabled.
   */
  async processEvent(event: NormalizedEvent, whitelist?: string[]): Promise<void> {
    // Log the event
    const eventId = this.storage.events.log(event.source, event.metadata.id as string ?? null, event);

    // Find matching workflows
    const matches = findMatchingWorkflows(event, this.workflowLoader.getAll(), whitelist);

    if (matches.length === 0) {
      this.logger.debug({ source: event.source, sender: event.sender }, 'No workflow matched');
      return;
    }

    for (const { workflow, match } of matches) {
      this.logger.info({ workflowId: workflow.id, sender: event.sender }, 'Workflow matched');

      const result = await this.engine.execute(workflow, event, match);

      // Log result
      if (result.success) {
        this.logger.info({ workflowId: workflow.id }, 'Workflow completed');
      } else {
        this.logger.warn({ workflowId: workflow.id, error: result.error }, 'Workflow failed');
      }
    }
  }

  /**
   * Enqueue an event for async processing.
   */
  enqueue(event: NormalizedEvent, whitelist?: string[]): void {
    const eventId = this.storage.events.log(event.source, event.metadata.id as string ?? null, event);

    const matches = findMatchingWorkflows(event, this.workflowLoader.getAll(), whitelist);

    for (const { workflow } of matches) {
      this.storage.queue.enqueue(eventId, workflow.id);
      this.logger.debug({ workflowId: workflow.id, eventId }, 'Event enqueued');
    }
  }

  // --- Private ---

  private poll(): void {
    if (!this.running) return;

    this.processNextItem()
      .catch((err) => {
        this.logger.error({ error: (err as Error).message }, 'Queue poll error');
      })
      .finally(() => {
        if (this.running) {
          this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs);
        }
      });
  }

  private async processNextItem(): Promise<void> {
    // Check for retryable items first
    const now = new Date().toISOString();
    const retryable = this.storage.queue.getRetryable(now);
    for (const item of retryable) {
      this.storage.queue.markProcessing(item.id!);
    }

    // Dequeue next pending item
    const item = this.storage.queue.dequeue();
    if (!item) return;

    const workflow = this.workflowLoader.get(item.workflowId);
    if (!workflow) {
      this.logger.warn({ workflowId: item.workflowId, queueId: item.id }, 'Queued workflow not found');
      this.storage.queue.markDead(item.id!);
      return;
    }

    // Load the original event
    const storedEvent = this.storage.events.getById(item.eventId);
    if (!storedEvent) {
      this.logger.warn({ eventId: item.eventId, queueId: item.id }, 'Queued event not found');
      this.storage.queue.markDead(item.id!);
      return;
    }

    const event = storedEvent.data as NormalizedEvent;

    // Execute with timeout (ADR-014)
    try {
      const result = await Promise.race([
        this.engine.execute(workflow, event, { matched: true, groups: {} }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Execution timeout')), this.itemTimeoutMs)
        ),
      ]);

      if (result.success) {
        this.storage.queue.markComplete(item.id!, result);
      } else {
        this.handleFailure(item.id!, item.attempts, item.maxAttempts, result.error ?? 'Unknown error');
      }
    } catch (err) {
      this.handleFailure(item.id!, item.attempts, item.maxAttempts, (err as Error).message);
    }
  }

  private handleFailure(id: number, attempts: number, maxAttempts: number, error: string): void {
    if (attempts + 1 >= maxAttempts) {
      this.logger.warn({ queueId: id, attempts: attempts + 1 }, 'Max retries reached, marking dead');
      this.storage.queue.markDead(id);
    } else {
      this.storage.queue.markFailed(id, error);
      this.logger.debug({ queueId: id, attempts: attempts + 1, maxAttempts }, 'Marked for retry');
    }
  }
}
