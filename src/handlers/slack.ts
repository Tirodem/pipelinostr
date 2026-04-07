/**
 * Slack handler (v2)
 *
 * Sends messages via Slack incoming webhook.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class SlackHandler extends BaseHandler {
  static type = 'slack';
  static configSchema = z.object({
    webhook_url: z.union([z.string(), z.instanceof(Secret)]),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Slack';
  readonly type = 'slack';

  private webhookUrl = '';

  async initialize(config: Record<string, unknown>): Promise<void> {
    const url = config.webhook_url;
    this.webhookUrl = url instanceof Secret ? url.unwrap() : String(url);
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const text = action.text as string ?? action.content as string;
    if (!text) return { success: false, error: 'Missing "text" field' };

    const channel = action.channel as string | undefined;
    const username = action.username as string | undefined;
    const icon_emoji = action.icon_emoji as string | undefined;

    const payload: Record<string, unknown> = { text };
    if (channel) payload.channel = channel;
    if (username) payload.username = username;
    if (icon_emoji) payload.icon_emoji = icon_emoji;

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        return { success: false, error: `Slack ${response.status}: ${body.slice(0, 200)}` };
      }

      return { success: true, data: { status: response.status } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}
}
