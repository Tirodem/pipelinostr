/**
 * Traccar SMS handler (v2)
 *
 * Sends SMS via Traccar SMS Gateway API. No external npm deps.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class TraccarSmsHandler extends BaseHandler {
  static type = 'traccar_sms';
  static configSchema = z.object({
    gateway_url: z.string(),
    token: z.union([z.string(), z.instanceof(Secret)]),
    default_sender: z.string().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Traccar SMS';
  readonly type = 'traccar_sms';

  private gatewayUrl = '';
  private token = '';

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.gatewayUrl = (config.gateway_url as string).replace(/\/$/, '');
    this.token = config.token instanceof Secret
      ? (config.token as Secret).unwrap()
      : config.token as string;
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const message = action.message as string;
    if (!message) return { success: false, error: 'Missing message' };

    const toRaw = action.to as string | string[];
    if (!toRaw) return { success: false, error: 'Missing to' };

    const recipients = Array.isArray(toRaw)
      ? toRaw
      : toRaw.split(',').map((s) => s.trim());

    const results: string[] = [];
    const errors: string[] = [];

    for (const phone of recipients) {
      try {
        const response = await fetch(`${this.gatewayUrl}/api/sms`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({ to: phone, message }),
        });

        if (response.ok) {
          results.push(phone);
        } else {
          errors.push(`${phone}: HTTP ${response.status}`);
        }
      } catch (err) {
        errors.push(`${phone}: ${(err as Error).message}`);
      }
    }

    if (results.length === 0) {
      return { success: false, error: errors.join('; ') };
    }

    return {
      success: true,
      data: { sent: results, failed: errors.length > 0 ? errors : undefined },
    };
  }

  async shutdown(): Promise<void> {}
}
