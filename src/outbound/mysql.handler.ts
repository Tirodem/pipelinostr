/**
 * MySQL Handler - Stockage d'événements dans MySQL/MariaDB
 */

import mysql, { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface MysqlHandlerConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connection_limit: number;
  default_table: string;
}

export interface MysqlActionConfig extends HandlerConfig {
  operation?: 'insert' | 'upsert' | 'update' | 'delete' | 'query';
  table?: string;
  columns?: Record<string, unknown>;
  where?: Record<string, unknown>;
  query?: string;
  values?: unknown[];
}

export class MysqlHandler implements Handler {
  readonly name = 'MySQL Handler';
  readonly type = 'mysql';

  private config: MysqlHandlerConfig;
  private pool: Pool | null = null;

  constructor(config: MysqlHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.pool = mysql.createPool({
      host: this.config.host,
      port: this.config.port || 3306,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      connectionLimit: this.config.connection_limit || 10,
      waitForConnections: true,
    });

    // Test connection
    const conn = await this.pool.getConnection();
    conn.release();
    console.log(`[MySQL] Connecté à ${this.config.database}@${this.config.host}`);
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!this.pool) {
      return { success: false, error: 'MySQL non initialisé' };
    }

    const params = config as MysqlActionConfig;
    const event = context.event as { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][]; sig: string };
    const transformedContent = (context.transformedContent as string) || event.content;

    const table = params.table || this.config.default_table;
    const operation = params.operation || 'insert';

    try {
      switch (operation) {
        case 'insert':
          return this.insertRow(table, event, transformedContent, params);
        case 'upsert':
          return this.upsertRow(table, event, transformedContent, params);
        case 'update':
          return this.updateRows(table, event, params);
        case 'delete':
          return this.deleteRows(table, event, params);
        case 'query':
          return this.executeQuery(table, params);
        default:
          return { success: false, error: `Opération inconnue: ${operation}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async insertRow(
    table: string,
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][]; sig: string },
    content: string,
    params: MysqlActionConfig
  ): Promise<HandlerResult> {
    const columns = params.columns || this.buildDefaultColumns(event, content);
    const keys = Object.keys(columns);
    const values = Object.values(columns);
    const placeholders = keys.map(() => '?').join(', ');

    const sql = `INSERT INTO ${this.escapeIdentifier(table)} (${keys.map(k => this.escapeIdentifier(k)).join(', ')}) VALUES (${placeholders})`;

    const [result] = await this.pool!.execute<ResultSetHeader>(sql, values);

    console.log(`[MySQL] Ligne insérée dans ${table}: ID=${result.insertId}`);

    return {
      success: true,
      data: {
        operation: 'insert',
        table,
        affected_rows: result.affectedRows,
        inserted_id: result.insertId,
      },
    };
  }

  private async upsertRow(
    table: string,
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][]; sig: string },
    content: string,
    params: MysqlActionConfig
  ): Promise<HandlerResult> {
    const columns = params.columns || this.buildDefaultColumns(event, content);
    const keys = Object.keys(columns);
    const values = Object.values(columns);
    const placeholders = keys.map(() => '?').join(', ');
    const updates = keys.map(k => `${this.escapeIdentifier(k)} = VALUES(${this.escapeIdentifier(k)})`).join(', ');

    const sql = `INSERT INTO ${this.escapeIdentifier(table)} (${keys.map(k => this.escapeIdentifier(k)).join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;

    const [result] = await this.pool!.execute<ResultSetHeader>(sql, values);

    console.log(`[MySQL] Upsert dans ${table}: affected=${result.affectedRows}`);

    return {
      success: true,
      data: {
        operation: 'upsert',
        table,
        affected_rows: result.affectedRows,
      },
    };
  }

  private async updateRows(
    table: string,
    event: { id: string },
    params: MysqlActionConfig
  ): Promise<HandlerResult> {
    const columns = params.columns || {};
    const where = params.where || { event_id: event.id };

    const setClause = Object.keys(columns)
      .map(k => `${this.escapeIdentifier(k)} = ?`)
      .join(', ');
    const whereClause = Object.keys(where)
      .map(k => `${this.escapeIdentifier(k)} = ?`)
      .join(' AND ');

    const values = [...Object.values(columns), ...Object.values(where)];
    const sql = `UPDATE ${this.escapeIdentifier(table)} SET ${setClause} WHERE ${whereClause}`;

    const [result] = await this.pool!.execute<ResultSetHeader>(sql, values);

    console.log(`[MySQL] Lignes mises à jour dans ${table}: ${result.affectedRows}`);

    return {
      success: true,
      data: {
        operation: 'update',
        table,
        affected_rows: result.affectedRows,
      },
    };
  }

  private async deleteRows(
    table: string,
    event: { id: string },
    params: MysqlActionConfig
  ): Promise<HandlerResult> {
    const where = params.where || { event_id: event.id };

    const whereClause = Object.keys(where)
      .map(k => `${this.escapeIdentifier(k)} = ?`)
      .join(' AND ');

    const sql = `DELETE FROM ${this.escapeIdentifier(table)} WHERE ${whereClause}`;

    const [result] = await this.pool!.execute<ResultSetHeader>(sql, Object.values(where));

    console.log(`[MySQL] Lignes supprimées dans ${table}: ${result.affectedRows}`);

    return {
      success: true,
      data: {
        operation: 'delete',
        table,
        affected_rows: result.affectedRows,
      },
    };
  }

  private async executeQuery(
    table: string,
    params: MysqlActionConfig
  ): Promise<HandlerResult> {
    if (!params.query) {
      return { success: false, error: 'Query SQL requise pour opération query' };
    }

    const [rows] = await this.pool!.execute<RowDataPacket[]>(params.query, params.values || []);

    console.log(`[MySQL] Query exécutée: ${rows.length} résultats`);

    return {
      success: true,
      data: {
        operation: 'query',
        table,
        affected_rows: rows.length,
        rows,
      },
    };
  }

  private escapeIdentifier(name: string): string {
    return `\`${name.replace(/`/g, '``')}\``;
  }

  private buildDefaultColumns(
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][]; sig: string },
    content: string
  ): Record<string, unknown> {
    return {
      event_id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      created_at: new Date(event.created_at * 1000),
      content: event.content,
      transformed_content: content,
      tags: JSON.stringify(event.tags),
      sig: event.sig,
      received_at: new Date(),
    };
  }

  async shutdown(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('[MySQL] Pool fermé');
    }
  }
}
