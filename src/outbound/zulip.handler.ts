import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface ZulipHandlerOptions {
  siteUrl: string; // e.g., https://your-org.zulipchat.com
  email: string; // Bot email
  apiKey: string;
  defaultStream?: string | undefined;
  defaultTopic?: string | undefined;
}

export interface ZulipActionConfig extends HandlerConfig {
  // Message type: 'stream' for channel messages, 'private' for DMs
  type: 'stream' | 'private';
  // For stream messages
  stream?: string | undefined;
  topic?: string | undefined;
  // For private messages (user emails or IDs)
  to?: string | string[] | undefined;
  // Message content (Zulip markdown supported)
  content: string;
}

export class ZulipHandler implements Handler {
  readonly name = 'Zulip Handler';
  readonly type = 'zulip';

  private siteUrl: string;
  private email: string;
  private apiKey: string;
  private defaultStream?: string | undefined;
  private defaultTopic?: string | undefined;
  private authHeader: string;

  constructor(options: ZulipHandlerOptions) {
    this.siteUrl = options.siteUrl.replace(/\/$/, ''); // Remove trailing slash
    this.email = options.email;
    this.apiKey = options.apiKey;
    this.defaultStream = options.defaultStream;
    this.defaultTopic = options.defaultTopic;

    // Basic auth: email:api_key
    const credentials = Buffer.from(`${this.email}:${this.apiKey}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
  }

  async initialize(): Promise<void> {
    // Verify credentials by fetching server settings
    try {
      const response = await fetch(`${this.siteUrl}/api/v1/server_settings`);
      const data = (await response.json()) as {
        zulip_version?: string;
        push_notifications_enabled?: boolean;
      };

      if (!data.zulip_version) {
        throw new Error('Invalid Zulip server response');
      }

      // Now verify auth by getting user info
      const userResponse = await fetch(`${this.siteUrl}/api/v1/users/me`, {
        headers: { Authorization: this.authHeader },
      });

      const userData = (await userResponse.json()) as {
        result: string;
        email?: string;
        msg?: string;
      };

      if (userData.result !== 'success') {
        throw new Error(userData.msg ?? 'Authentication failed');
      }

      logger.info(
        { siteUrl: this.siteUrl, email: userData.email, version: data.zulip_version },
        'Zulip handler initialized'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to initialize Zulip handler');
      throw error;
    }
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const zulipConfig = config as ZulipActionConfig;

    if (!zulipConfig.content) {
      return { success: false, error: 'Missing required field: content' };
    }

    if (!zulipConfig.type) {
      return { success: false, error: 'Missing required field: type (stream or private)' };
    }

    if (zulipConfig.type === 'stream') {
      return this.sendStreamMessage(zulipConfig);
    } else if (zulipConfig.type === 'private') {
      return this.sendPrivateMessage(zulipConfig);
    }

    return { success: false, error: 'Invalid message type. Use "stream" or "private"' };
  }

  private async sendStreamMessage(config: ZulipActionConfig): Promise<HandlerResult> {
    const stream = config.stream ?? this.defaultStream;
    const topic = config.topic ?? this.defaultTopic ?? 'notifications';

    if (!stream) {
      return { success: false, error: 'Missing required field: stream' };
    }

    try {
      const params = new URLSearchParams({
        type: 'stream',
        to: stream,
        topic: topic,
        content: config.content,
      });

      const response = await fetch(`${this.siteUrl}/api/v1/messages`, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const data = (await response.json()) as {
        result: string;
        id?: number;
        msg?: string;
      };

      if (data.result !== 'success') {
        logger.error({ stream, topic, error: data.msg }, 'Failed to send Zulip stream message');
        return { success: false, error: data.msg ?? 'Unknown Zulip API error' };
      }

      logger.info({ stream, topic, messageId: data.id }, 'Zulip stream message sent successfully');

      return {
        success: true,
        data: {
          message_id: data.id,
          stream,
          topic,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ stream, error: errorMessage }, 'Failed to send Zulip stream message');
      return { success: false, error: errorMessage };
    }
  }

  private async sendPrivateMessage(config: ZulipActionConfig): Promise<HandlerResult> {
    if (!config.to) {
      return { success: false, error: 'Missing required field: to (recipient emails)' };
    }

    const recipients = Array.isArray(config.to) ? config.to : [config.to];

    try {
      const params = new URLSearchParams({
        type: 'private',
        to: JSON.stringify(recipients),
        content: config.content,
      });

      const response = await fetch(`${this.siteUrl}/api/v1/messages`, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const data = (await response.json()) as {
        result: string;
        id?: number;
        msg?: string;
      };

      if (data.result !== 'success') {
        logger.error(
          { to: recipients, error: data.msg },
          'Failed to send Zulip private message'
        );
        return { success: false, error: data.msg ?? 'Unknown Zulip API error' };
      }

      logger.info(
        { to: recipients, messageId: data.id },
        'Zulip private message sent successfully'
      );

      return {
        success: true,
        data: {
          message_id: data.id,
          recipients,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to send Zulip private message');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Zulip handler shut down');
  }
}
