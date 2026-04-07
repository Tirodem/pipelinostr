/**
 * Wallet handler (v2)
 *
 * Bitcoin wallet lookups via mempool.space API.
 * No external dependencies — uses fetch.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';

export class WalletHandler extends BaseHandler {
  static type = 'wallet';
  static configSchema = z.object({
    mempool_url: z.string().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Wallet';
  readonly type = 'wallet';

  private mempoolUrl = 'https://mempool.space/api';

  async initialize(config: Record<string, unknown>): Promise<void> {
    if (config.mempool_url) this.mempoolUrl = (config.mempool_url as string).replace(/\/$/, '');
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const operation = (action.operation as string) ?? 'address';

    try {
      switch (operation) {
        case 'address': {
          const address = action.address as string;
          if (!address) return { success: false, error: 'Missing "address" field' };
          const res = await fetch(`${this.mempoolUrl}/address/${address}`);
          if (!res.ok) return { success: false, error: `Mempool ${res.status}` };
          const data = await res.json() as Record<string, unknown>;
          return { success: true, data };
        }
        case 'tx': {
          const txid = action.txid as string;
          if (!txid) return { success: false, error: 'Missing "txid" field' };
          const res = await fetch(`${this.mempoolUrl}/tx/${txid}`);
          if (!res.ok) return { success: false, error: `Mempool ${res.status}` };
          const data = await res.json() as Record<string, unknown>;
          return { success: true, data };
        }
        case 'fees': {
          const res = await fetch(`${this.mempoolUrl}/v1/fees/recommended`);
          if (!res.ok) return { success: false, error: `Mempool ${res.status}` };
          const data = await res.json() as Record<string, unknown>;
          return { success: true, data };
        }
        case 'block_height': {
          const res = await fetch(`${this.mempoolUrl}/blocks/tip/height`);
          if (!res.ok) return { success: false, error: `Mempool ${res.status}` };
          const height = await res.text();
          return { success: true, data: { height: parseInt(height, 10) } };
        }
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}
}
