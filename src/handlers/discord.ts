/**
 * Discord handler (v2)
 *
 * Sends messages via Discord webhook.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class DiscordHandler extends BaseHandler {
  static type = 'discord';
  static configSchema = z.object({
    webhook_url: z.union([z.string(), z.instanceof(Secret)]),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Discord';
  readonly type = 'discord';

  private webhookUrl = '';

  async initialize(config: Record<string, unknown>): Promise<void> {
    const url = config.webhook_url;
    this.webhookUrl = url instanceof Secret ? url.unwrap() : String(url);
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const content = action.content as string ?? action.text as string;
    if (!content) return { success: false, error: 'Missing "content" or "text" field' };

    const username = action.username as string | undefined;
    const avatar_url = action.avatar_url as string | undefined;

    const payload: Record<string, unknown> = { content };
    if (username) payload.username = username;
    if (avatar_url) payload.avatar_url = avatar_url;

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Discord ${response.status}: ${text.slice(0, 200)}` };
      }

      return { success: true, data: { status: response.status } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}
}
