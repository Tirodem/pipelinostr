/**
 * Redis Handler - Stockage et pub/sub avec Redis
 */

import { createClient, RedisClientType } from 'redis';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface RedisHandlerConfig {
  enabled: boolean;
  url: string;
  password?: string | undefined;
  database: number;
  key_prefix: string;
}

export interface RedisActionConfig extends HandlerConfig {
  operation?: 'set' | 'get' | 'hset' | 'lpush' | 'rpush' | 'sadd' | 'zadd' | 'publish' | 'incr' | 'expire';
  key: string;
  value?: unknown;
  field?: string;
  fields?: Record<string, string>;
  score?: number;
  channel?: string;
  ttl?: number;
}

export class RedisHandler implements Handler {
  readonly name = 'Redis Handler';
  readonly type = 'redis';

  private config: RedisHandlerConfig;
  private client: RedisClientType | null = null;

  constructor(config: RedisHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    const clientOptions: { url: string; database?: number; password?: string } = {
      url: this.config.url,
      database: this.config.database || 0,
    };

    if (this.config.password) {
      clientOptions.password = this.config.password;
    }

    this.client = createClient(clientOptions);

    this.client.on('error', (err) => console.error('[Redis] Erreur:', err));

    await this.client.connect();
    console.log(`[Redis] Connecté`);
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!this.client) {
      return { success: false, error: 'Redis non initialisé' };
    }

    const params = config as RedisActionConfig;
    const event = context.event as { id: string; pubkey: string; kind: number; created_at: number; content: string };
    const transformedContent = (context.transformedContent as string) || event.content;

    const operation = params.operation || 'set';
    const key = this.resolveKey(params.key, event);

    try {
      switch (operation) {
        case 'set':
          return this.setKey(key, event, transformedContent, params);
        case 'get':
          return this.getKey(key);
        case 'hset':
          return this.hashSet(key, event, transformedContent, params);
        case 'lpush':
          return this.listPush(key, event, transformedContent, params, 'left');
        case 'rpush':
          return this.listPush(key, event, transformedContent, params, 'right');
        case 'sadd':
          return this.setAdd(key, event, params);
        case 'zadd':
          return this.sortedSetAdd(key, event, params);
        case 'publish':
          return this.publishMessage(event, transformedContent, params);
        case 'incr':
          return this.increment(key);
        case 'expire':
          return this.setExpire(key, params);
        default:
          return { success: false, error: `Opération inconnue: ${operation}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async setKey(
    key: string,
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string },
    content: string,
    params: RedisActionConfig
  ): Promise<HandlerResult> {
    const fullKey = this.getFullKey(key);
    const value = params.value !== undefined
      ? (typeof params.value === 'string' ? params.value : JSON.stringify(params.value))
      : JSON.stringify(this.buildDefaultValue(event, content));

    if (params.ttl) {
      await this.client!.setEx(fullKey, params.ttl, value);
    } else {
      await this.client!.set(fullKey, value);
    }

    console.log(`[Redis] SET ${fullKey}`);

    return {
      success: true,
      data: { operation: 'set', key: fullKey },
    };
  }

  private async getKey(key: string): Promise<HandlerResult> {
    const fullKey = this.getFullKey(key);
    const value = await this.client!.get(fullKey);

    return {
      success: true,
      data: {
        operation: 'get',
        key: fullKey,
        result: value ? JSON.parse(value) : null,
      },
    };
  }

  private async hashSet(
    key: string,
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string },
    content: string,
    params: RedisActionConfig
  ): Promise<HandlerResult> {
    const fullKey = this.getFullKey(key);
    const fields = params.fields || {
      event_id: event.id,
      pubkey: event.pubkey,
      kind: event.kind.toString(),
      content: content,
      created_at: event.created_at.toString(),
    };

    await this.client!.hSet(fullKey, fields);

    if (params.ttl) {
      await this.client!.expire(fullKey, params.ttl);
    }

    console.log(`[Redis] HSET ${fullKey}`);

    return {
      success: true,
      data: { operation: 'hset', key: fullKey },
    };
  }

  private async listPush(
    key: string,
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string },
    content: string,
    params: RedisActionConfig,
    direction: 'left' | 'right'
  ): Promise<HandlerResult> {
    const fullKey = this.getFullKey(key);
    const value = params.value !== undefined
      ? (typeof params.value === 'string' ? params.value : JSON.stringify(params.value))
      : JSON.stringify(this.buildDefaultValue(event, content));

    const length = direction === 'left'
      ? await this.client!.lPush(fullKey, value)
      : await this.client!.rPush(fullKey, value);

    if (params.ttl) {
      await this.client!.expire(fullKey, params.ttl);
    }

    console.log(`[Redis] ${direction.toUpperCase()}PUSH ${fullKey} (length: ${length})`);

    return {
      success: true,
      data: {
        operation: direction === 'left' ? 'lpush' : 'rpush',
        key: fullKey,
        result: length,
      },
    };
  }

  private async setAdd(
    key: string,
    event: { id: string },
    params: RedisActionConfig
  ): Promise<HandlerResult> {
    const fullKey = this.getFullKey(key);
    const value = params.value !== undefined
      ? (typeof params.value === 'string' ? params.value : JSON.stringify(params.value))
      : event.id;

    const added = await this.client!.sAdd(fullKey, value);

    if (params.ttl) {
      await this.client!.expire(fullKey, params.ttl);
    }

    console.log(`[Redis] SADD ${fullKey}`);

    return {
      success: true,
      data: { operation: 'sadd', key: fullKey, result: added },
    };
  }

  private async sortedSetAdd(
    key: string,
    event: { id: string; created_at: number },
    params: RedisActionConfig
  ): Promise<HandlerResult> {
    const fullKey = this.getFullKey(key);
    const value = params.value !== undefined
      ? (typeof params.value === 'string' ? params.value : JSON.stringify(params.value))
      : event.id;
    const score = params.score !== undefined ? params.score : event.created_at;

    const added = await this.client!.zAdd(fullKey, { score, value });

    if (params.ttl) {
      await this.client!.expire(fullKey, params.ttl);
    }

    console.log(`[Redis] ZADD ${fullKey} (score: ${score})`);

    return {
      success: true,
      data: { operation: 'zadd', key: fullKey, result: added },
    };
  }

  private async publishMessage(
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string },
    content: string,
    params: RedisActionConfig
  ): Promise<HandlerResult> {
    const channel = params.channel || 'nostr:events';
    const message = params.value !== undefined
      ? (typeof params.value === 'string' ? params.value : JSON.stringify(params.value))
      : JSON.stringify(this.buildDefaultValue(event, content));

    const subscribers = await this.client!.publish(channel, message);

    console.log(`[Redis] PUBLISH ${channel} (${subscribers} subscribers)`);

    return {
      success: true,
      data: { operation: 'publish', key: channel, result: subscribers },
    };
  }

  private async increment(key: string): Promise<HandlerResult> {
    const fullKey = this.getFullKey(key);
    const value = await this.client!.incr(fullKey);

    console.log(`[Redis] INCR ${fullKey} = ${value}`);

    return {
      success: true,
      data: { operation: 'incr', key: fullKey, result: value },
    };
  }

  private async setExpire(key: string, params: RedisActionConfig): Promise<HandlerResult> {
    const fullKey = this.getFullKey(key);
    const ttl = params.ttl || 3600;

    await this.client!.expire(fullKey, ttl);

    console.log(`[Redis] EXPIRE ${fullKey} ${ttl}s`);

    return {
      success: true,
      data: { operation: 'expire', key: fullKey },
    };
  }

  private getFullKey(key: string): string {
    const prefix = this.config.key_prefix || 'pipelinostr';
    return `${prefix}:${key}`;
  }

  private resolveKey(
    template: string,
    event: { id: string; pubkey: string; kind: number; created_at: number }
  ): string {
    return template
      .replace(/{event_id}/g, event.id.substring(0, 8))
      .replace(/{pubkey}/g, event.pubkey.substring(0, 8))
      .replace(/{kind}/g, event.kind.toString())
      .replace(/{timestamp}/g, event.created_at.toString());
  }

  private buildDefaultValue(
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string },
    content: string
  ): Record<string, unknown> {
    return {
      event_id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      created_at: event.created_at,
      content: event.content,
      transformed_content: content,
      received_at: Date.now(),
    };
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      console.log('[Redis] Connexion fermée');
    }
  }
}
