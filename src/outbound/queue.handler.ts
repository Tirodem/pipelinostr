/**
 * Queue Handler - Schedule internal events for background processing
 *
 * System handler (always active) for queue operations.
 * Allows workflows to schedule delayed events (e.g., for polling/monitoring).
 *
 * Use cases:
 * - Schedule periodic checks (address monitoring)
 * - Delayed notifications
 * - Background job scheduling
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';
import { enqueuePollEvent } from '../queue/queue-worker.js';
import { logger } from '../persistence/logger.js';

interface QueueHandlerConfig {
  enabled: boolean;
}

export interface QueueActionConfig extends HandlerConfig {
  action: 'enqueue';

  // For 'enqueue' action
  poll_type: string;                      // Type of poll (e.g., 'address_monitor')
  address?: string;                       // Bitcoin address (for wallet monitoring)
  target_pubkey?: string;                 // Who to notify
  dm_format?: 'nip04' | 'nip17';          // DM format to use for notifications (propagated from trigger)
  data?: Record<string, unknown>;         // Additional context data
  delay_ms?: number;                      // Delay before processing (default: 0)
  priority?: number;                      // Higher = more urgent (default: 0)
  max_retries?: number;                   // Max retry attempts (default: 3)
}

export class QueueHandler implements Handler {
  readonly name = 'Queue Handler';
  readonly type = 'queue';

  private config: QueueHandlerConfig;

  constructor(config: QueueHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    logger.info('[Queue] Handler initialized');
  }

  async shutdown(): Promise<void> {
    logger.info('[Queue] Handler shutdown');
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    const params = config as QueueActionConfig;

    try {
      switch (params.action) {
        case 'enqueue':
          return this.handleEnqueue(params, context);

        default:
          return {
            success: false,
            error: `Unknown action: ${(params as { action: string }).action}`,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, action: params.action }, '[Queue] Action failed');
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private handleEnqueue(
    params: QueueActionConfig,
    context: Record<string, unknown>
  ): HandlerResult {
    if (!params.poll_type) {
      return {
        success: false,
        error: 'poll_type is required for enqueue action',
      };
    }

    // Parse delay_ms as number (may come as string from template)
    const delayMs = typeof params.delay_ms === 'string'
      ? parseInt(params.delay_ms, 10)
      : params.delay_ms;

    // Extract dm_format: explicit param > trigger.dm_format > undefined
    const trigger = context.trigger as Record<string, unknown> | undefined;
    const dmFormat = params.dm_format || (trigger?.dm_format as 'nip04' | 'nip17' | undefined);

    // Build options object, only including defined properties
    const options: {
      address?: string;
      target_pubkey?: string;
      dm_format?: 'nip04' | 'nip17';
      data?: Record<string, unknown>;
      delay_ms?: number;
      priority?: number;
      maxRetries?: number;
    } = {
      delay_ms: delayMs || 0,
    };
    if (params.address) options.address = params.address;
    if (params.target_pubkey) options.target_pubkey = params.target_pubkey;
    if (dmFormat) options.dm_format = dmFormat;
    if (params.data) options.data = params.data;
    if (params.priority !== undefined) options.priority = params.priority;
    if (params.max_retries !== undefined) options.maxRetries = params.max_retries;

    const queueId = enqueuePollEvent(params.poll_type, options);

    const scheduledAt = new Date(Date.now() + (delayMs || 0));

    logger.debug(
      {
        queueId,
        pollType: params.poll_type,
        address: params.address,
        delayMs: delayMs || 0,
        scheduledAt: scheduledAt.toISOString(),
      },
      '[Queue] Event enqueued'
    );

    return {
      success: true,
      data: {
        queue_id: queueId,
        poll_type: params.poll_type,
        address: params.address,
        target_pubkey: params.target_pubkey,
        delay_ms: delayMs || 0,
        scheduled_at: scheduledAt.toISOString(),
      },
    };
  }
}
