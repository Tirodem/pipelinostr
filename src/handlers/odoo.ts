/**
 * Odoo handler (v2)
 *
 * JSON-RPC operations on Odoo ERP. No external npm deps.
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class OdooHandler extends BaseHandler {
  static type = 'odoo';
  static configSchema = z.object({
    url: z.string(),
    database: z.string(),
    username: z.string(),
    api_key: z.union([z.string(), z.instanceof(Secret)]),
    enabled: z.boolean().optional(),
  });

  readonly name = 'Odoo';
  readonly type = 'odoo';

  private url = '';
  private database = '';
  private username = '';
  private apiKey = '';
  private uid: number | null = null;
  private sessionExpiry = 0;

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.url = (config.url as string).replace(/\/$/, '');
    this.database = config.database as string;
    this.username = config.username as string;
    this.apiKey = config.api_key instanceof Secret
      ? (config.api_key as Secret).unwrap()
      : config.api_key as string;
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    const op = action.action as string;
    if (!op) return { success: false, error: 'Missing action' };

    try {
      await this.ensureAuthenticated();

      const model = action.model as string;
      const method = action.method as string ?? 'search_read';
      const args = action.args as unknown[] ?? [];
      const kwargs = action.kwargs as Record<string, unknown> ?? {};

      if (!model) return { success: false, error: 'Missing model' };

      const result = await this.rpc('object', 'execute_kw', [
        this.database, this.uid, this.apiKey, model, method, args, kwargs,
      ]);

      return { success: true, data: { result } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {
    this.uid = null;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.uid && Date.now() < this.sessionExpiry) return;

    const result = await this.rpc('common', 'authenticate', [
      this.database, this.username, this.apiKey, {},
    ]);

    if (!result || result === false) throw new Error('Odoo authentication failed');
    this.uid = result as number;
    this.sessionExpiry = Date.now() + 3600000; // 1 hour
  }

  private async rpc(service: string, method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args: params },
        id: Date.now(),
      }),
    });

    const data = (await response.json()) as { result?: unknown; error?: { message: string } };
    if (data.error) throw new Error(data.error.message);
    return data.result;
  }
}
