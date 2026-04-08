/**
 * Claude handler (v2)
 *
 * AI chat via Anthropic API. No external npm deps (uses fetch).
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class ClaudeHandler extends BaseHandler {
  static type = 'claude';
  static configSchema = z.object({
    api_key: z.union([z.string(), z.instanceof(Secret)]),
    model: z.string().optional(),
    max_tokens: z.number().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Claude';
  readonly type = 'claude';

  private apiKey = '';
  private model = 'claude-sonnet-4-6';
  private maxTokens = 1024;

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.apiKey = config.api_key instanceof Secret
      ? (config.api_key as Secret).unwrap()
      : config.api_key as string;
    this.model = (config.model as string) ?? this.model;
    this.maxTokens = (config.max_tokens as number) ?? this.maxTokens;
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const op = (action.action as string) ?? 'chat';

    switch (op) {
      case 'chat':
      case 'generate':
        return this.chat(action);
      default:
        return { success: false, error: `Unknown claude action: ${op}` };
    }
  }

  async shutdown(): Promise<void> {}

  private async chat(action: Record<string, unknown>): Promise<HandlerResult> {
    const message = (action.message as string) ?? (action.prompt as string);
    if (!message) return { success: false, error: 'Missing message or prompt' };

    const systemPrompt = action.system_prompt as string | undefined;
    const model = (action.model as string) ?? this.model;
    const maxTokens = (action.max_tokens as number) ?? this.maxTokens;

    try {
      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: message }],
      };

      if (systemPrompt) body.system = systemPrompt;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Claude API ${response.status}: ${errText.slice(0, 200)}` };
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };

      const text = data.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');

      return {
        success: true,
        data: {
          response: text,
          model,
          input_tokens: data.usage.input_tokens,
          output_tokens: data.usage.output_tokens,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
