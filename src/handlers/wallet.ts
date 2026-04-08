/**
 * Wallet handler (v2)
 *
 * Bitcoin wallet lookups via mempool.space API.
 * Operations: address, tx, fees, block_height, get_addresses, check_transaction
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
    // Support both 'operation' and 'action' fields
    const operation = (action.operation as string) ?? (action.action as string) ?? 'address';

    try {
      switch (operation) {
        case 'address':
        case 'get_addresses': {
          const address = action.address as string;
          if (!address) return { success: false, error: 'Missing "address" field' };
          const res = await fetch(`${this.mempoolUrl}/address/${address}`);
          if (!res.ok) return { success: false, error: `Mempool ${res.status}` };
          const data = await res.json() as Record<string, unknown>;

          // Build formatted output
          const stats = data.chain_stats as Record<string, unknown> ?? {};
          const funded = Number(stats.funded_txo_sum ?? 0);
          const spent = Number(stats.spent_txo_sum ?? 0);
          const balance = funded - spent;
          const formatted = [
            `Address: ${address}`,
            `Balance: ${balance} sats (${(balance / 1e8).toFixed(8)} BTC)`,
            `Total received: ${funded} sats`,
            `Total sent: ${spent} sats`,
            `Transactions: ${stats.tx_count ?? 0}`,
          ].join('\n');

          return { success: true, data: { ...data, formatted, balance, address } };
        }

        case 'tx':
        case 'check_transaction': {
          const txid = (action.txid as string) ?? (action.tx_id as string);
          if (!txid) return { success: false, error: 'Missing "txid" field' };
          const res = await fetch(`${this.mempoolUrl}/tx/${txid}`);
          if (!res.ok) return { success: false, error: `Mempool ${res.status}` };
          const data = await res.json() as Record<string, unknown>;

          const confirmed = !!(data.status as Record<string, unknown>)?.confirmed;
          const blockHeight = (data.status as Record<string, unknown>)?.block_height;
          const formatted = [
            `TX: ${txid.slice(0, 16)}...`,
            `Status: ${confirmed ? `Confirmed (block ${blockHeight})` : 'Unconfirmed'}`,
            `Fee: ${data.fee ?? '?'} sats`,
          ].join('\n');

          return { success: true, data: { ...data, formatted, confirmed, txid } };
        }

        case 'fees': {
          const res = await fetch(`${this.mempoolUrl}/v1/fees/recommended`);
          if (!res.ok) return { success: false, error: `Mempool ${res.status}` };
          const data = await res.json() as Record<string, unknown>;
          const formatted = [
            'Recommended fees (sat/vB):',
            `  Fastest: ${data.fastestFee}`,
            `  30 min: ${data.halfHourFee}`,
            `  1 hour: ${data.hourFee}`,
            `  Economy: ${data.economyFee}`,
            `  Minimum: ${data.minimumFee}`,
          ].join('\n');
          return { success: true, data: { ...data, formatted } };
        }

        case 'block_height': {
          const res = await fetch(`${this.mempoolUrl}/blocks/tip/height`);
          if (!res.ok) return { success: false, error: `Mempool ${res.status}` };
          const height = await res.text();
          const formatted = `Current block height: ${height}`;
          return { success: true, data: { height: parseInt(height, 10), formatted } };
        }

        default:
          return { success: false, error: `Unknown wallet operation: ${operation}` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {}
}
