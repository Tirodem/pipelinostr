import { basename } from 'path';
import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface TelegramHandlerOptions {
  botToken: string;
  defaultChatId?: string | undefined;
}

export interface TelegramActionConfig extends HandlerConfig {
  chat_id: string;
  action?: 'message' | 'voice';
  // For text messages
  text?: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2' | undefined;
  disable_notification?: boolean | undefined;
  disable_web_page_preview?: boolean | undefined;
  // For voice messages (single file)
  voice_file?: string;
  caption?: string;
  duration?: number;
  // For voice messages (multiple files - sent sequentially)
  voice_files?: Array<{ file_path: string; caption?: string }>;
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

    const action = telegramConfig.action ?? 'message';

    if (action === 'voice') {
      return this.sendVoice(chatId, telegramConfig);
    }

    return this.sendMessage(chatId, telegramConfig);
  }

  private async sendMessage(chatId: string, config: TelegramActionConfig): Promise<HandlerResult> {
    if (!config.text) {
      return { success: false, error: 'Missing required field: text' };
    }

    try {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text: config.text,
      };

      if (config.parse_mode) {
        payload.parse_mode = config.parse_mode;
      }

      if (config.disable_notification !== undefined) {
        payload.disable_notification = config.disable_notification;
      }

      if (config.disable_web_page_preview !== undefined) {
        payload.disable_web_page_preview = config.disable_web_page_preview;
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

  private async sendVoice(chatId: string, config: TelegramActionConfig): Promise<HandlerResult> {
    // Handle multiple files
    if (config.voice_files && config.voice_files.length > 0) {
      return this.sendMultipleVoices(chatId, config);
    }

    // Handle single file
    if (!config.voice_file) {
      return { success: false, error: 'Missing required field: voice_file or voice_files' };
    }

    return this.sendSingleVoice(chatId, config.voice_file, config.caption, config.duration, config.disable_notification);
  }

  private async sendSingleVoice(
    chatId: string,
    voiceFile: string,
    caption?: string,
    duration?: number,
    disableNotification?: boolean
  ): Promise<HandlerResult> {
    try {
      // Use multipart/form-data to upload voice file
      const formData = new FormData();
      formData.append('chat_id', chatId);

      // Read file and create blob
      const { promises: fs } = await import('fs');
      const fileBuffer = await fs.readFile(voiceFile);
      const filename = basename(voiceFile);
      // Detect MIME type from extension
      const mimeType = voiceFile.endsWith('.ogg') ? 'audio/ogg' : 'audio/wav';
      const blob = new Blob([fileBuffer], { type: mimeType });
      formData.append('voice', blob, filename);

      if (caption) {
        formData.append('caption', caption);
      }

      if (duration !== undefined) {
        formData.append('duration', duration.toString());
      }

      if (disableNotification !== undefined) {
        formData.append('disable_notification', disableNotification.toString());
      }

      const response = await fetch(`${this.baseUrl}/sendVoice`, {
        method: 'POST',
        body: formData,
      });

      const data = (await response.json()) as {
        ok: boolean;
        result?: { message_id: number; voice?: { file_id: string; duration: number } };
        description?: string;
      };

      if (!data.ok) {
        logger.error({ chatId, error: data.description }, 'Failed to send Telegram voice');
        return { success: false, error: data.description ?? 'Unknown Telegram API error' };
      }

      logger.info(
        { chatId, messageId: data.result?.message_id, duration: data.result?.voice?.duration },
        'Telegram voice sent successfully'
      );

      return {
        success: true,
        data: {
          message_id: data.result?.message_id,
          chat_id: chatId,
          voice_file_id: data.result?.voice?.file_id,
          duration: data.result?.voice?.duration,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ chatId, error: errorMessage }, 'Failed to send Telegram voice');
      return { success: false, error: errorMessage };
    }
  }

  private async sendMultipleVoices(chatId: string, config: TelegramActionConfig): Promise<HandlerResult> {
    const files = config.voice_files!;
    const results: Array<{ message_id: number | undefined; voice_file_id: string | undefined; duration: number | undefined }> = [];
    const errors: string[] = [];

    logger.info({ chatId, count: files.length }, 'Sending multiple voice messages');

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const caption = file.caption ?? (files.length > 1 ? `Part ${i + 1}/${files.length}` : undefined);

      const result = await this.sendSingleVoice(
        chatId,
        file.file_path,
        caption,
        undefined,
        config.disable_notification
      );

      if (result.success && result.data) {
        results.push({
          message_id: result.data.message_id as number | undefined,
          voice_file_id: result.data.voice_file_id as string | undefined,
          duration: result.data.duration as number | undefined,
        });
      } else {
        errors.push(`Part ${i + 1}: ${result.error}`);
      }

      // Small delay between messages to avoid rate limiting
      if (i < files.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (errors.length > 0 && results.length === 0) {
      return { success: false, error: errors.join('; ') };
    }

    logger.info(
      { chatId, sent: results.length, failed: errors.length },
      'Multiple voice messages completed'
    );

    return {
      success: true,
      data: {
        chat_id: chatId,
        messages: results,
        total_sent: results.length,
        total_failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      },
    };
  }

  async shutdown(): Promise<void> {
    logger.info('Telegram handler shut down');
  }
}
