import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface SlackHandlerOptions {
  // For webhook mode
  webhookUrl?: string | undefined;
  // For Bot API mode
  botToken?: string | undefined;
  defaultChannel?: string | undefined;
}

export interface SlackActionConfig extends HandlerConfig {
  // Target (for Bot API mode)
  channel?: string | undefined;
  // Message content
  text: string;
  // Optional: use webhook URL per-action (overrides handler default)
  webhook_url?: string | undefined;
  // Rich formatting
  blocks?: unknown[] | undefined;
  attachments?: unknown[] | undefined;
  // Options
  unfurl_links?: boolean | undefined;
  unfurl_media?: boolean | undefined;
}

export class SlackHandler implements Handler {
  readonly name = 'Slack Handler';
  readonly type = 'slack';

  private webhookUrl?: string | undefined;
  private botToken?: string | undefined;
  private defaultChannel?: string | undefined;

  constructor(options: SlackHandlerOptions) {
    this.webhookUrl = options.webhookUrl;
    this.botToken = options.botToken;
    this.defaultChannel = options.defaultChannel;
  }

  async initialize(): Promise<void> {
    if (!this.webhookUrl && !this.botToken) {
      throw new Error('Slack handler requires either webhookUrl or botToken');
    }

    // If using Bot API, verify token
    if (this.botToken) {
      try {
        const response = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        });

        const data = (await response.json()) as { ok: boolean; team?: string; error?: string };

        if (!data.ok) {
          throw new Error(data.error ?? 'Invalid bot token');
        }

        logger.info({ team: data.team }, 'Slack handler initialized (Bot API)');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage }, 'Failed to initialize Slack handler');
        throw error;
      }
    } else {
      logger.info('Slack handler initialized (Webhook mode)');
    }
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const slackConfig = config as SlackActionConfig;

    if (!slackConfig.text && !slackConfig.blocks) {
      return { success: false, error: 'Missing required field: text or blocks' };
    }

    // Determine which method to use
    const webhookUrl = slackConfig.webhook_url ?? this.webhookUrl;

    if (webhookUrl) {
      return this.sendViaWebhook(webhookUrl, slackConfig);
    }

    if (this.botToken) {
      return this.sendViaBotApi(slackConfig);
    }

    return { success: false, error: 'No webhook URL or bot token configured' };
  }

  private async sendViaWebhook(
    webhookUrl: string,
    config: SlackActionConfig
  ): Promise<HandlerResult> {
    try {
      const payload: Record<string, unknown> = {
        text: config.text,
      };

      if (config.blocks) {
        payload.blocks = config.blocks;
      }

      if (config.attachments) {
        payload.attachments = config.attachments;
      }

      if (config.unfurl_links !== undefined) {
        payload.unfurl_links = config.unfurl_links;
      }

      if (config.unfurl_media !== undefined) {
        payload.unfurl_media = config.unfurl_media;
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();

      if (!response.ok || responseText !== 'ok') {
        logger.error({ error: responseText }, 'Failed to send Slack webhook message');
        return { success: false, error: responseText };
      }

      logger.info('Slack webhook message sent successfully');

      return {
        success: true,
        data: { method: 'webhook' },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to send Slack webhook message');
      return { success: false, error: errorMessage };
    }
  }

  private async sendViaBotApi(config: SlackActionConfig): Promise<HandlerResult> {
    const channel = config.channel ?? this.defaultChannel;

    if (!channel) {
      return { success: false, error: 'Missing required field: channel' };
    }

    try {
      const payload: Record<string, unknown> = {
        channel,
        text: config.text,
      };

      if (config.blocks) {
        payload.blocks = config.blocks;
      }

      if (config.attachments) {
        payload.attachments = config.attachments;
      }

      if (config.unfurl_links !== undefined) {
        payload.unfurl_links = config.unfurl_links;
      }

      if (config.unfurl_media !== undefined) {
        payload.unfurl_media = config.unfurl_media;
      }

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as {
        ok: boolean;
        ts?: string;
        channel?: string;
        error?: string;
      };

      if (!data.ok) {
        logger.error({ channel, error: data.error }, 'Failed to send Slack message');
        return { success: false, error: data.error ?? 'Unknown Slack API error' };
      }

      logger.info({ channel, ts: data.ts }, 'Slack message sent successfully');

      return {
        success: true,
        data: {
          method: 'bot_api',
          ts: data.ts,
          channel: data.channel,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to send Slack message');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Slack handler shut down');
  }
}
