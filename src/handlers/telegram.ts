/**
 * Telegram handler (v2)
 *
 * Sends messages and voice files via Telegram Bot API.
 */

import { z } from 'zod';
import { basename } from 'node:path';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class TelegramHandler extends BaseHandler {
  static type = 'telegram';
  static configSchema = z.object({
    bot_token: z.union([z.string(), z.instanceof(Secret)]),
    default_chat_id: z.string().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Telegram';
  readonly type = 'telegram';

  private botToken = '';
  private defaultChatId?: string | undefined;
  private baseUrl = '';

  async initialize(config: Record<string, unknown>): Promise<void> {
    const token = config.bot_token;
    this.botToken = token instanceof Secret ? token.unwrap() : String(token);
    this.defaultChatId = config.default_chat_id as string | undefined;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;

    // Verify bot token
    const response = await fetch(`${this.baseUrl}/getMe`);
    const data = (await response.json()) as { ok: boolean; result?: { username: string } };
    if (!data.ok) throw new Error('Invalid Telegram bot token');
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const chatId = (action.chat_id as string) ?? this.defaultChatId;
    if (!chatId) return { success: false, error: 'Missing chat_id' };

    const actionType = (action.action as string) ?? 'message';

    if (actionType === 'voice') {
      return this.sendVoice(chatId, action);
    }

    return this.sendMessage(chatId, action);
  }

  async shutdown(): Promise<void> {}

  private async sendMessage(chatId: string, action: Record<string, unknown>): Promise<HandlerResult> {
    const text = action.text as string;
    if (!text) return { success: false, error: 'Missing text' };

    const payload: Record<string, unknown> = { chat_id: chatId, text };
    if (action.parse_mode) payload.parse_mode = action.parse_mode;
    if (action.disable_notification !== undefined) payload.disable_notification = action.disable_notification;
    if (action.disable_web_page_preview !== undefined) payload.disable_web_page_preview = action.disable_web_page_preview;

    const response = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
    if (!data.ok) return { success: false, error: data.description ?? 'Telegram API error' };

    return { success: true, data: { message_id: data.result?.message_id, chat_id: chatId } };
  }

  private async sendVoice(chatId: string, action: Record<string, unknown>): Promise<HandlerResult> {
    const voiceFile = action.voice_file as string;
    if (!voiceFile) return { success: false, error: 'Missing voice_file' };

    const { promises: fs } = await import('node:fs');
    const fileBuffer = await fs.readFile(voiceFile);
    const filename = basename(voiceFile);
    const mimeType = voiceFile.endsWith('.ogg') ? 'audio/ogg' : 'audio/wav';

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('voice', new Blob([fileBuffer], { type: mimeType }), filename);
    if (action.caption) formData.append('caption', String(action.caption));

    const response = await fetch(`${this.baseUrl}/sendVoice`, {
      method: 'POST',
      body: formData,
    });

    const data = (await response.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
    if (!data.ok) return { success: false, error: data.description ?? 'Telegram API error' };

    return { success: true, data: { message_id: data.result?.message_id, chat_id: chatId } };
  }
}
