/**
 * PostgreSQL handler (v2)
 *
 * Executes SQL queries on PostgreSQL.
 * Optional dependency: pg
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class PostgresHandler extends BaseHandler {
  static type = 'postgres';
  static configSchema = z.object({
    connection_string: z.union([z.string(), z.instanceof(Secret)]),
    database: z.string().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'PostgreSQL';
  readonly type = 'postgres';

  private pool: unknown = null;

  async initialize(config: Record<string, unknown>): Promise<void> {
    const pg = await import('pg');
    const connStr = config.connection_string instanceof Secret
      ? (config.connection_string as Secret).unwrap()
      : config.connection_string as string;

    this.pool = new pg.default.Pool({ connectionString: connStr });

    // Verify connection
    const client = await (this.pool as { connect: () => Promise<{ release: () => void }> }).connect();
    client.release();
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    if (!this.pool) return { success: false, error: 'PostgreSQL not connected' };

    const query = action.query as string;
    if (!query) return { success: false, error: 'Missing "query" field' };

    const params = (action.params as unknown[]) ?? [];

    try {
      const pool = this.pool as {
        query: (text: string, params: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
      };
      const result = await pool.query(query, params);
      return {
        success: true,
        data: {
          rows: result.rows,
          rowCount: result.rowCount,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {
    if (this.pool) {
      await (this.pool as { end: () => Promise<void> }).end();
      this.pool = null;
    }
  }
}
