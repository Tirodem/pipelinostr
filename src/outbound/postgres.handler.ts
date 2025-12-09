/**
 * PostgreSQL Handler - Stockage d'événements dans PostgreSQL
 */

import pg from 'pg';
const { Pool } = pg;
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface PostgresHandlerConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  max_connections: number;
  default_table: string;
}

export interface PostgresActionConfig extends HandlerConfig {
  operation?: 'insert' | 'upsert' | 'update' | 'delete' | 'query';
  table?: string;
  columns?: Record<string, unknown>;
  where?: Record<string, unknown>;
  conflict_columns?: string[];
  query?: string;
  values?: unknown[];
}

export class PostgresHandler implements Handler {
  readonly name = 'PostgreSQL Handler';
  readonly type = 'postgres';

  private config: PostgresHandlerConfig;
  private pool: pg.Pool | null = null;

  constructor(config: PostgresHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port || 5432,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      max: this.config.max_connections || 10,
    });

    // Test connection
    const client = await this.pool.connect();
    client.release();
    console.log(`[PostgreSQL] Connecté à ${this.config.database}@${this.config.host}`);
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!this.pool) {
      return { success: false, error: 'PostgreSQL non initialisé' };
    }

    const params = config as PostgresActionConfig;
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
    params: PostgresActionConfig
  ): Promise<HandlerResult> {
    const columns = params.columns || this.buildDefaultColumns(event, content);
    const keys = Object.keys(columns);
    const values = Object.values(columns);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

    const sql = `INSERT INTO ${this.escapeIdentifier(table)} (${keys.map(k => this.escapeIdentifier(k)).join(', ')}) VALUES (${placeholders}) RETURNING *`;

    const result = await this.pool!.query(sql, values);

    console.log(`[PostgreSQL] Ligne insérée dans ${table}`);

    return {
      success: true,
      data: {
        operation: 'insert',
        table,
        affected_rows: result.rowCount || 0,
        rows: result.rows,
      },
    };
  }

  private async upsertRow(
    table: string,
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][]; sig: string },
    content: string,
    params: PostgresActionConfig
  ): Promise<HandlerResult> {
    const columns = params.columns || this.buildDefaultColumns(event, content);
    const keys = Object.keys(columns);
    const values = Object.values(columns);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const conflictColumns = params.conflict_columns || ['event_id'];
    const updates = keys
      .filter(k => !conflictColumns.includes(k))
      .map(k => `${this.escapeIdentifier(k)} = EXCLUDED.${this.escapeIdentifier(k)}`)
      .join(', ');

    const sql = `
      INSERT INTO ${this.escapeIdentifier(table)} (${keys.map(k => this.escapeIdentifier(k)).join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (${conflictColumns.map(c => this.escapeIdentifier(c)).join(', ')})
      DO UPDATE SET ${updates}
      RETURNING *
    `;

    const result = await this.pool!.query(sql, values);

    console.log(`[PostgreSQL] Upsert dans ${table}: ${result.rowCount} lignes`);

    return {
      success: true,
      data: {
        operation: 'upsert',
        table,
        affected_rows: result.rowCount || 0,
        rows: result.rows,
      },
    };
  }

  private async updateRows(
    table: string,
    event: { id: string },
    params: PostgresActionConfig
  ): Promise<HandlerResult> {
    const columns = params.columns || {};
    const where = params.where || { event_id: event.id };

    const columnKeys = Object.keys(columns);
    const whereKeys = Object.keys(where);
    let paramIndex = 1;

    const setClause = columnKeys
      .map(k => `${this.escapeIdentifier(k)} = $${paramIndex++}`)
      .join(', ');
    const whereClause = whereKeys
      .map(k => `${this.escapeIdentifier(k)} = $${paramIndex++}`)
      .join(' AND ');

    const values = [...Object.values(columns), ...Object.values(where)];
    const sql = `UPDATE ${this.escapeIdentifier(table)} SET ${setClause} WHERE ${whereClause}`;

    const result = await this.pool!.query(sql, values);

    console.log(`[PostgreSQL] Lignes mises à jour dans ${table}: ${result.rowCount}`);

    return {
      success: true,
      data: {
        operation: 'update',
        table,
        affected_rows: result.rowCount || 0,
      },
    };
  }

  private async deleteRows(
    table: string,
    event: { id: string },
    params: PostgresActionConfig
  ): Promise<HandlerResult> {
    const where = params.where || { event_id: event.id };
    const whereKeys = Object.keys(where);
    let paramIndex = 1;

    const whereClause = whereKeys
      .map(k => `${this.escapeIdentifier(k)} = $${paramIndex++}`)
      .join(' AND ');

    const sql = `DELETE FROM ${this.escapeIdentifier(table)} WHERE ${whereClause}`;

    const result = await this.pool!.query(sql, Object.values(where));

    console.log(`[PostgreSQL] Lignes supprimées dans ${table}: ${result.rowCount}`);

    return {
      success: true,
      data: {
        operation: 'delete',
        table,
        affected_rows: result.rowCount || 0,
      },
    };
  }

  private async executeQuery(
    table: string,
    params: PostgresActionConfig
  ): Promise<HandlerResult> {
    if (!params.query) {
      return { success: false, error: 'Query SQL requise pour opération query' };
    }

    const result = await this.pool!.query(params.query, params.values || []);

    console.log(`[PostgreSQL] Query exécutée: ${result.rowCount} résultats`);

    return {
      success: true,
      data: {
        operation: 'query',
        table,
        affected_rows: result.rowCount || 0,
        rows: result.rows,
      },
    };
  }

  private escapeIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
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
      console.log('[PostgreSQL] Pool fermé');
    }
  }
}
