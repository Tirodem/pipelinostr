/**
 * be-BOP handler (v2)
 *
 * Parses be-BOP order data from HTML/text content.
 * No external dependencies.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';

export class BebopHandler extends BaseHandler {
  static type = 'bebop';
  static configSchema = z.object({
    enabled: z.boolean().optional(),
  });

  readonly name = 'be-BOP';
  readonly type = 'bebop';

  async initialize(_config: Record<string, unknown>): Promise<void> {}

  async execute(action: Record<string, unknown>, context: ActionContext): Promise<HandlerResult> {
    const content = (action.content as string)
      ?? (context.trigger.content as string)
      ?? '';

    if (!content) return { success: false, error: 'Missing "content" field' };

    try {
      const parsed = this.parseOrder(content);
      return { success: true, data: parsed };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}

  private parseOrder(content: string): Record<string, unknown> {
    const result: Record<string, unknown> = { raw: content };

    // Extract order number: "order #123" or "commande #123"
    const orderMatch = content.match(/(?:order|commande)\s*#?(\d+)/i);
    if (orderMatch) result.order_id = orderMatch[1];

    // Extract amount: "1234 sats" or "0.001 BTC"
    const satsMatch = content.match(/([\d,]+)\s*sats?/i);
    if (satsMatch) result.amount_sats = parseInt(satsMatch[1]!.replace(/,/g, ''), 10);

    const btcMatch = content.match(/([\d.]+)\s*BTC/i);
    if (btcMatch) result.amount_btc = parseFloat(btcMatch[1]!);

    // Extract email
    const emailMatch = content.match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (emailMatch) result.email = emailMatch[0];

    // Extract status keywords
    const statusKeywords = ['paid', 'pending', 'confirmed', 'shipped', 'cancelled'];
    for (const kw of statusKeywords) {
      if (content.toLowerCase().includes(kw)) {
        result.status = kw;
        break;
      }
    }

    return result;
  }
}
