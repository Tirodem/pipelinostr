/**
 * MQTT Handler - Publication sur broker MQTT
 * Compatible avec Home Assistant, Mosquitto, AWS IoT, etc.
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

let mqtt: any;

interface MqttHandlerConfig {
  enabled: boolean;
  broker_url: string;
  username?: string | undefined;
  password?: string | undefined;
  client_id?: string | undefined;
  keepalive?: number | undefined;
  clean?: boolean | undefined;
  reconnect_period?: number | undefined;
  connect_timeout?: number | undefined;
  ca?: string | undefined;
  cert?: string | undefined;
  key?: string | undefined;
  reject_unauthorized?: boolean | undefined;
  default_topic?: string | undefined;
  topic_prefix?: string | undefined;
}

export interface MqttActionConfig extends HandlerConfig {
  topic?: string | undefined;
  payload?: string | Record<string, unknown> | undefined;
  format?: 'text' | 'json' | undefined;
  qos?: 0 | 1 | 2 | undefined;
  retain?: boolean | undefined;
}

export class MqttHandler implements Handler {
  readonly name = 'MQTT Handler';
  readonly type = 'mqtt';

  private config: MqttHandlerConfig;
  private client: any = null;
  private connected = false;

  constructor(config: MqttHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      // @ts-expect-error - Optional dependency, may not be installed
      mqtt = await import('mqtt');
    } catch {
      throw new Error('mqtt module not found. Install it with: npm install mqtt');
    }

    await this.connect();
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: any = {
        clientId: this.config.client_id || `pipelinostr_${Date.now()}`,
        keepalive: this.config.keepalive || 60,
        clean: this.config.clean !== false,
        reconnectPeriod: this.config.reconnect_period || 5000,
        connectTimeout: this.config.connect_timeout || 30000,
      };

      if (this.config.username) {
        options.username = this.config.username;
      }
      if (this.config.password) {
        options.password = this.config.password;
      }

      if (this.config.reject_unauthorized !== undefined) {
        options.rejectUnauthorized = this.config.reject_unauthorized;
      }

      this.client = mqtt.connect(this.config.broker_url, options);

      this.client.on('connect', () => {
        this.connected = true;
        console.log(`[MQTT] Connecté à ${this.config.broker_url}`);
        resolve();
      });

      this.client.on('error', (err: Error) => {
        console.error(`[MQTT] Erreur: ${err.message}`);
        if (!this.connected) {
          reject(err);
        }
      });

      this.client.on('offline', () => {
        this.connected = false;
        console.warn('[MQTT] Déconnecté (offline)');
      });

      this.client.on('reconnect', () => {
        console.log('[MQTT] Tentative de reconnexion...');
      });

      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('MQTT connection timeout'));
        }
      }, this.config.connect_timeout || 30000);
    });
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!this.client || !this.connected) {
      return { success: false, error: 'MQTT non connecté' };
    }

    const params = config as MqttActionConfig;
    const event = context.event as {
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      content: string;
    };
    const transformedContent = (context.transformedContent as string) || event.content;

    try {
      let topic = params.topic || this.config.default_topic;
      if (!topic) {
        topic = `nostr/events/${event.kind}`;
      }
      if (this.config.topic_prefix) {
        topic = `${this.config.topic_prefix}/${topic}`;
      }

      let payload: string;
      if (params.format === 'json' || typeof params.payload === 'object') {
        const payloadObj = params.payload && typeof params.payload === 'object'
          ? params.payload
          : {
              event_id: event.id,
              pubkey: event.pubkey,
              kind: event.kind,
              content: transformedContent,
              created_at: event.created_at,
            };
        payload = JSON.stringify(payloadObj);
      } else {
        payload = (params.payload as string) || transformedContent;
      }

      const publishOptions = {
        qos: params.qos || 0,
        retain: params.retain || false,
      };

      await this.publish(topic, payload, publishOptions);

      console.log(`[MQTT] Publié sur ${topic} (${payload.length} octets, QoS ${publishOptions.qos})`);

      return {
        success: true,
        data: {
          topic,
          payload_size: payload.length,
          qos: publishOptions.qos,
          retain: publishOptions.retain,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private publish(topic: string, payload: string, options: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(topic, payload, options, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await new Promise<void>((resolve) => {
        this.client.end(false, {}, () => {
          resolve();
        });
      });
    }
    this.connected = false;
    console.log('[MQTT] Handler arrêté');
  }
}
