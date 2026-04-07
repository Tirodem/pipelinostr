/**
 * ntfy handler (v2)
 *
 * Sends push notifications via ntfy.sh (or self-hosted ntfy server).
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';

export class NtfyHandler extends BaseHandler {
  static type = 'ntfy';
  static configSchema = z.object({
    server_url: z.string().optional(),
    default_topic: z.string().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'ntfy';
  readonly type = 'ntfy';

  private serverUrl = 'https://ntfy.sh';
  private defaultTopic?: string | undefined;

  async initialize(config: Record<string, unknown>): Promise<void> {
    if (config.server_url) this.serverUrl = (config.server_url as string).replace(/\/$/, '');
    this.defaultTopic = config.default_topic as string | undefined;
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const topic = (action.topic as string) ?? this.defaultTopic;
    if (!topic) return { success: false, error: 'Missing "topic" field' };

    const message = (action.message as string) ?? (action.text as string);
    if (!message) return { success: false, error: 'Missing "message" field' };

    const headers: Record<string, string> = {};
    if (action.title) headers['Title'] = String(action.title);
    if (action.priority) headers['Priority'] = String(action.priority);
    if (action.tags) headers['Tags'] = String(action.tags);

    try {
      const response = await fetch(`${this.serverUrl}/${topic}`, {
        method: 'POST',
        headers,
        body: message,
      });

      if (!response.ok) {
        const body = await response.text();
        return { success: false, error: `ntfy ${response.status}: ${body.slice(0, 200)}` };
      }

      const data = await response.json() as Record<string, unknown>;
      return { success: true, data: { id: data.id, topic } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}
}
