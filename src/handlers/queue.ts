/**
 * Queue handler (v2)
 *
 * Schedules internal events for background processing.
 * Used by wallet monitoring workflows to schedule periodic checks.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';

export class QueueHandler extends BaseHandler {
  static type = 'queue';
  static configSchema = z.object({ enabled: z.boolean().optional() });

  readonly name = 'Queue';
  readonly type = 'queue';

  async initialize(_config: Record<string, unknown>): Promise<void> {}

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const op = (action.action as string) ?? 'enqueue';

    if (op === 'enqueue') {
      // TODO: integrate with queue worker's enqueue for internal poll events
      const pollType = action.poll_type as string;
      const delayMs = (action.delay_ms as number) ?? 0;

      return {
        success: true,
        data: {
          poll_type: pollType,
          delay_ms: delayMs,
          scheduled: true,
          note: 'Internal poll scheduling — requires queue worker integration',
        },
      };
    }

    return { success: false, error: `Unknown queue action: ${op}` };
  }

  async shutdown(): Promise<void> {}
}
