/**
 * Mastodon handler (v2)
 *
 * Posts statuses (toots) via Mastodon API.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class MastodonHandler extends BaseHandler {
  static type = 'mastodon';
  static configSchema = z.object({
    instance_url: z.string(),
    access_token: z.union([z.string(), z.instanceof(Secret)]),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Mastodon';
  readonly type = 'mastodon';

  private instanceUrl = '';
  private accessToken = '';

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.instanceUrl = (config.instance_url as string).replace(/\/$/, '');
    this.accessToken = config.access_token instanceof Secret
      ? (config.access_token as Secret).unwrap()
      : config.access_token as string;

    // Verify credentials
    const response = await fetch(`${this.instanceUrl}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!response.ok) throw new Error('Invalid Mastodon access token');
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const status = action.status as string;
    if (!status) return { success: false, error: 'Missing status' };

    const formData = new URLSearchParams();
    formData.append('status', status);
    if (action.visibility) formData.append('visibility', action.visibility as string);
    if (action.spoiler_text) formData.append('spoiler_text', action.spoiler_text as string);
    if (action.in_reply_to_id) formData.append('in_reply_to_id', action.in_reply_to_id as string);
    if (action.language) formData.append('language', action.language as string);
    if (action.sensitive !== undefined) formData.append('sensitive', String(action.sensitive));

    const response = await fetch(`${this.instanceUrl}/api/v1/statuses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errData = (await response.json()) as { error?: string };
      return { success: false, error: errData.error ?? 'Mastodon API error' };
    }

    const result = (await response.json()) as { id?: string; url?: string };
    return { success: true, data: { status_id: result.id, url: result.url } };
  }

  async shutdown(): Promise<void> {}
}
