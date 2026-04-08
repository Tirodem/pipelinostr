/**
 * MQTT handler (v2)
 *
 * Publishes messages to MQTT topics.
 * Optional dependency: mqtt
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class MqttHandler extends BaseHandler {
  static type = 'mqtt';
  static npmDependencies = ['mqtt'];
  static configSchema = z.object({
    broker_url: z.string(),
    username: z.string().optional(),
    password: z.union([z.string(), z.instanceof(Secret)]).optional(),
    default_topic: z.string().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'MQTT';
  readonly type = 'mqtt';

  private client: unknown = null;
  private defaultTopic?: string | undefined;

  async initialize(config: Record<string, unknown>): Promise<void> {
    const mqtt = await import('mqtt' as string) as { connectAsync: (url: string, opts?: unknown) => Promise<unknown> };
    const options: Record<string, unknown> = {};

    if (config.username) options.username = config.username;
    if (config.password) {
      options.password = config.password instanceof Secret
        ? (config.password as Secret).unwrap()
        : config.password;
    }

    this.client = await mqtt.connectAsync(config.broker_url as string, options);
    this.defaultTopic = config.default_topic as string | undefined;
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    if (!this.client) return { success: false, error: 'MQTT not connected' };

    const topic = (action.topic as string) ?? this.defaultTopic;
    if (!topic) return { success: false, error: 'Missing "topic" field' };

    const message = (action.message as string) ?? (action.text as string) ?? '';
    const qos = (action.qos as number) ?? 0;
    const retain = (action.retain as boolean) ?? false;

    try {
      const client = this.client as { publishAsync: (topic: string, message: string, opts: unknown) => Promise<void> };
      await client.publishAsync(topic, message, { qos, retain });
      return { success: true, data: { topic, qos, retain } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await (this.client as { endAsync: () => Promise<void> }).endAsync();
      this.client = null;
    }
  }
}
