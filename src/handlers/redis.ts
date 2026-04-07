/**
 * Redis handler (v2)
 *
 * Set/get/publish operations on Redis.
 * Optional dependency: redis
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';

export class RedisHandler extends BaseHandler {
  static type = 'redis';
  static configSchema = z.object({
    url: z.string().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Redis';
  readonly type = 'redis';

  private client: unknown = null;

  async initialize(config: Record<string, unknown>): Promise<void> {
    const redis = await import('redis');
    this.client = redis.createClient({ url: (config.url as string) ?? 'redis://localhost:6379' });
    await (this.client as { connect: () => Promise<void> }).connect();
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    if (!this.client) return { success: false, error: 'Redis not connected' };

    const operation = (action.operation as string) ?? 'set';
    const client = this.client as {
      set: (key: string, value: string) => Promise<string | null>;
      get: (key: string) => Promise<string | null>;
      publish: (channel: string, message: string) => Promise<number>;
      del: (key: string) => Promise<number>;
    };

    try {
      switch (operation) {
        case 'set': {
          const key = action.key as string;
          if (!key) return { success: false, error: 'Missing "key" field' };
          await client.set(key, String(action.value ?? ''));
          return { success: true, data: { key, operation } };
        }
        case 'get': {
          const key = action.key as string;
          if (!key) return { success: false, error: 'Missing "key" field' };
          const value = await client.get(key);
          return { success: true, data: { key, value, found: value !== null } };
        }
        case 'publish': {
          const channel = action.channel as string;
          if (!channel) return { success: false, error: 'Missing "channel" field' };
          const receivers = await client.publish(channel, String(action.message ?? ''));
          return { success: true, data: { channel, receivers } };
        }
        case 'delete': {
          const key = action.key as string;
          if (!key) return { success: false, error: 'Missing "key" field' };
          const count = await client.del(key);
          return { success: true, data: { key, deleted: count > 0 } };
        }
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await (this.client as { disconnect: () => Promise<void> }).disconnect();
      this.client = null;
    }
  }
}
