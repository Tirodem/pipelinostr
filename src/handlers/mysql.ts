/**
 * MySQL handler (v2)
 *
 * Executes SQL queries on MySQL/MariaDB.
 * Optional dependency: mysql2
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class MysqlHandler extends BaseHandler {
  static type = 'mysql';
  static npmDependencies = ['mysql2'];
  static configSchema = z.object({
    host: z.string(),
    port: z.number().optional(),
    user: z.string(),
    password: z.union([z.string(), z.instanceof(Secret)]),
    database: z.string(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'MySQL';
  readonly type = 'mysql';

  private pool: unknown = null;

  async initialize(config: Record<string, unknown>): Promise<void> {
    const mysql = await import('mysql2/promise');
    const password = config.password instanceof Secret
      ? (config.password as Secret).unwrap()
      : config.password as string;

    this.pool = mysql.createPool({
      host: config.host as string,
      port: (config.port as number) ?? 3306,
      user: config.user as string,
      password,
      database: config.database as string,
    });

    // Verify connection
    const conn = await (this.pool as { getConnection: () => Promise<{ release: () => void }> }).getConnection();
    conn.release();
  }

  async execute(action: Record<string, unknown>, _context: ActionContext): Promise<HandlerResult> {
    if (!this.pool) return { success: false, error: 'MySQL not connected' };

    const query = action.query as string;
    if (!query) return { success: false, error: 'Missing "query" field' };

    const params = (action.params as unknown[]) ?? [];

    try {
      const pool = this.pool as {
        execute: (sql: string, params: unknown[]) => Promise<[unknown[], unknown]>;
      };
      const [rows] = await pool.execute(query, params);
      return {
        success: true,
        data: {
          rows: rows as unknown[],
          rowCount: Array.isArray(rows) ? rows.length : 0,
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
