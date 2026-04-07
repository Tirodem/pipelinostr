/**
 * Bluesky handler (v2)
 *
 * Posts to Bluesky via AT Protocol.
 * Optional dependency: @atproto/api
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class BlueskyHandler extends BaseHandler {
  static type = 'bluesky';
  static configSchema = z.object({
    service: z.string().optional(),
    identifier: z.string(),
    password: z.union([z.string(), z.instanceof(Secret)]),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Bluesky';
  readonly type = 'bluesky';

  private agent: unknown = null;

  async initialize(config: Record<string, unknown>): Promise<void> {
    const { BskyAgent } = await import('@atproto/api');

    const service = (config.service as string) ?? 'https://bsky.social';
    const password = config.password instanceof Secret
      ? (config.password as Secret).unwrap()
      : config.password as string;

    this.agent = new BskyAgent({ service });
    await (this.agent as { login: (opts: { identifier: string; password: string }) => Promise<void> }).login({
      identifier: config.identifier as string,
      password,
    });
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    if (!this.agent) return { success: false, error: 'Bluesky not authenticated' };

    const text = action.text as string;
    if (!text) return { success: false, error: 'Missing text' };

    try {
      const { RichText } = await import('@atproto/api');
      const rt = new RichText({ text });
      await rt.detectFacets(this.agent as Parameters<typeof rt.detectFacets>[0]);

      const post: Record<string, unknown> = {
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
      };

      if (action.langs) post.langs = action.langs;

      const result = await (this.agent as { post: (opts: unknown) => Promise<{ uri: string; cid: string }> }).post(post);

      return {
        success: true,
        data: { uri: result.uri, cid: result.cid },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}
}
