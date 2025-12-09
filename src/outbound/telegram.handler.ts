import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface TelegramHandlerOptions {
  botToken: string;
  defaultChatId?: string | undefined;
}

export interface TelegramActionConfig extends HandlerConfig {
  chat_id: string;
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2' | undefined;
  disable_notification?: boolean | undefined;
  disable_web_page_preview?: boolean | undefined;
}

export class TelegramHandler implements Handler {
  readonly name = 'Telegram Handler';
  readonly type = 'telegram';

  private botToken: string;
  private defaultChatId?: string | undefined;
  private baseUrl: string;

  constructor(options: TelegramHandlerOptions) {
    this.botToken = options.botToken;
    this.defaultChatId = options.defaultChatId;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async initialize(): Promise<void> {
    // Verify bot token by calling getMe
    try {
      const response = await fetch(`${this.baseUrl}/getMe`);
      const data = (await response.json()) as { ok: boolean; result?: { username: string } };

      if (!data.ok) {
        throw new Error('Invalid bot token');
      }

      logger.info({ username: data.result?.username }, 'Telegram handler initialized');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to initialize Telegram handler');
      throw error;
    }
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const telegramConfig = config as TelegramActionConfig;

    const chatId = telegramConfig.chat_id ?? this.defaultChatId;
    if (!chatId) {
      return { success: false, error: 'Missing required field: chat_id' };
    }

    if (!telegramConfig.text) {
      return { success: false, error: 'Missing required field: text' };
    }

    try {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text: telegramConfig.text,
      };

      if (telegramConfig.parse_mode) {
        payload.parse_mode = telegramConfig.parse_mode;
      }

      if (telegramConfig.disable_notification !== undefined) {
        payload.disable_notification = telegramConfig.disable_notification;
      }

      if (telegramConfig.disable_web_page_preview !== undefined) {
        payload.disable_web_page_preview = telegramConfig.disable_web_page_preview;
      }

      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };

      if (!data.ok) {
        logger.error({ chatId, error: data.description }, 'Failed to send Telegram message');
        return { success: false, error: data.description ?? 'Unknown Telegram API error' };
      }

      logger.info(
        { chatId, messageId: data.result?.message_id },
        'Telegram message sent successfully'
      );

      return {
        success: true,
        data: {
          message_id: data.result?.message_id,
          chat_id: chatId,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ chatId, error: errorMessage }, 'Failed to send Telegram message');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Telegram handler shut down');
  }
}
