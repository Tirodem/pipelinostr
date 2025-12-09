import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface DiscordHandlerOptions {
  // For webhook mode (simple, recommended for notifications)
  webhookUrl?: string | undefined;
  // For Bot API mode (more features)
  botToken?: string | undefined;
  defaultChannelId?: string | undefined;
}

export interface DiscordEmbed {
  title?: string | undefined;
  description?: string | undefined;
  url?: string | undefined;
  color?: number | undefined;
  timestamp?: string | undefined;
  footer?: { text: string; icon_url?: string | undefined } | undefined;
  author?: { name: string; url?: string | undefined; icon_url?: string | undefined } | undefined;
  fields?: Array<{ name: string; value: string; inline?: boolean | undefined }> | undefined;
}

export interface DiscordActionConfig extends HandlerConfig {
  // Target channel (for Bot API mode)
  channel_id?: string | undefined;
  // Webhook URL (overrides handler default)
  webhook_url?: string | undefined;
  // Message content
  content?: string | undefined;
  // Username override (webhook only)
  username?: string | undefined;
  // Avatar URL override (webhook only)
  avatar_url?: string | undefined;
  // Rich embeds
  embeds?: DiscordEmbed[] | undefined;
  // Text-to-speech
  tts?: boolean | undefined;
}

export class DiscordHandler implements Handler {
  readonly name = 'Discord Handler';
  readonly type = 'discord';

  private webhookUrl?: string | undefined;
  private botToken?: string | undefined;
  private defaultChannelId?: string | undefined;

  constructor(options: DiscordHandlerOptions = {}) {
    this.webhookUrl = options.webhookUrl;
    this.botToken = options.botToken;
    this.defaultChannelId = options.defaultChannelId;
  }

  async initialize(): Promise<void> {
    if (!this.webhookUrl && !this.botToken) {
      throw new Error('Discord handler requires either webhookUrl or botToken');
    }

    // Verify bot token if provided
    if (this.botToken) {
      try {
        const response = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${this.botToken}` },
        });

        if (!response.ok) {
          throw new Error('Invalid bot token');
        }

        const user = await response.json() as { username?: string };
        logger.info({ username: user.username }, 'Discord handler initialized (Bot API)');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage }, 'Failed to initialize Discord handler');
        throw error;
      }
    } else {
      logger.info('Discord handler initialized (Webhook mode)');
    }
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const discordConfig = config as DiscordActionConfig;

    if (!discordConfig.content && (!discordConfig.embeds || discordConfig.embeds.length === 0)) {
      return { success: false, error: 'Missing required field: content or embeds' };
    }

    const webhookUrl = discordConfig.webhook_url ?? this.webhookUrl;

    if (webhookUrl) {
      return this.sendViaWebhook(webhookUrl, discordConfig);
    }

    if (this.botToken) {
      return this.sendViaBotApi(discordConfig);
    }

    return { success: false, error: 'No webhook URL or bot token configured' };
  }

  private async sendViaWebhook(webhookUrl: string, config: DiscordActionConfig): Promise<HandlerResult> {
    try {
      const payload: Record<string, unknown> = {};

      if (config.content) {
        payload.content = config.content;
      }

      if (config.username) {
        payload.username = config.username;
      }

      if (config.avatar_url) {
        payload.avatar_url = config.avatar_url;
      }

      if (config.embeds && config.embeds.length > 0) {
        payload.embeds = config.embeds;
      }

      if (config.tts) {
        payload.tts = config.tts;
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'Failed to send Discord webhook');
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      logger.info('Discord webhook message sent successfully');

      return {
        success: true,
        data: { method: 'webhook' },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to send Discord webhook');
      return { success: false, error: errorMessage };
    }
  }

  private async sendViaBotApi(config: DiscordActionConfig): Promise<HandlerResult> {
    const channelId = config.channel_id ?? this.defaultChannelId;

    if (!channelId) {
      return { success: false, error: 'Missing required field: channel_id' };
    }

    try {
      const payload: Record<string, unknown> = {};

      if (config.content) {
        payload.content = config.content;
      }

      if (config.embeds && config.embeds.length > 0) {
        payload.embeds = config.embeds;
      }

      if (config.tts) {
        payload.tts = config.tts;
      }

      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json() as { message?: string };
        logger.error({ channelId, error: errorData.message }, 'Failed to send Discord message');
        return { success: false, error: errorData.message ?? 'Unknown Discord API error' };
      }

      const result = await response.json() as { id?: string };

      logger.info({ channelId, messageId: result.id }, 'Discord message sent successfully');

      return {
        success: true,
        data: {
          method: 'bot_api',
          message_id: result.id,
          channel_id: channelId,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to send Discord message');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Discord handler shut down');
  }
}
