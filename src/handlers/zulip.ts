/**
 * Zulip handler (v2)
 *
 * Sends stream and private messages via Zulip API.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class ZulipHandler extends BaseHandler {
  static type = 'zulip';
  static configSchema = z.object({
    site_url: z.string(),
    email: z.string(),
    api_key: z.union([z.string(), z.instanceof(Secret)]),
    default_stream: z.string().optional(),
    default_topic: z.string().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Zulip';
  readonly type = 'zulip';

  private siteUrl = '';
  private authHeader = '';
  private defaultStream?: string | undefined;
  private defaultTopic?: string | undefined;

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.siteUrl = (config.site_url as string).replace(/\/$/, '');
    const email = config.email as string;
    const apiKey = config.api_key instanceof Secret ? (config.api_key as Secret).unwrap() : config.api_key as string;
    this.defaultStream = config.default_stream as string | undefined;
    this.defaultTopic = config.default_topic as string | undefined;

    this.authHeader = `Basic ${Buffer.from(`${email}:${apiKey}`).toString('base64')}`;

    // Verify auth
    const response = await fetch(`${this.siteUrl}/api/v1/users/me`, {
      headers: { Authorization: this.authHeader },
    });
    const data = (await response.json()) as { result: string; msg?: string };
    if (data.result !== 'success') throw new Error(data.msg ?? 'Zulip auth failed');
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const content = action.content as string;
    if (!content) return { success: false, error: 'Missing content' };

    const msgType = (action.type as string) ?? 'stream';

    if (msgType === 'private') {
      return this.sendPrivate(action, content);
    }
    return this.sendStream(action, content);
  }

  async shutdown(): Promise<void> {}

  private async sendStream(action: Record<string, unknown>, content: string): Promise<HandlerResult> {
    const stream = (action.stream as string) ?? this.defaultStream;
    const topic = (action.topic as string) ?? this.defaultTopic ?? 'notifications';
    if (!stream) return { success: false, error: 'Missing stream' };

    const params = new URLSearchParams({ type: 'stream', to: stream, topic, content });

    const response = await fetch(`${this.siteUrl}/api/v1/messages`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = (await response.json()) as { result: string; id?: number; msg?: string };
    if (data.result !== 'success') return { success: false, error: data.msg ?? 'Zulip error' };

    return { success: true, data: { message_id: data.id, stream, topic } };
  }

  private async sendPrivate(action: Record<string, unknown>, content: string): Promise<HandlerResult> {
    const to = action.to as string | string[];
    if (!to) return { success: false, error: 'Missing to' };

    const recipients = Array.isArray(to) ? to : [to];
    const params = new URLSearchParams({ type: 'private', to: JSON.stringify(recipients), content });

    const response = await fetch(`${this.siteUrl}/api/v1/messages`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = (await response.json()) as { result: string; id?: number; msg?: string };
    if (data.result !== 'success') return { success: false, error: data.msg ?? 'Zulip error' };

    return { success: true, data: { message_id: data.id, recipients } };
  }
}
