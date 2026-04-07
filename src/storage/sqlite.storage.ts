/**
 * SQLite storage adapter (ADR-002, ADR-003, ADR-005)
 *
 * Implements the Storage port using better-sqlite3 with WAL mode.
 * Single-process only (ADR-006).
 */

import BetterSqlite3 from 'better-sqlite3';
import path from 'node:path';
import type {
  Storage, EventStorage, QueueStorage, StateStorage,
  RelayStorage, WorkflowTableStorage,
  StoredEvent, QueuedEvent, StateEntry, RelayInfo,
} from './storage.port.js';
import { runMigrations } from '../db/migrator.js';

// --- Type mapping for workflow tables (ADR-004) ---
const YAML_TO_SQLITE: Record<string, string> = {
  string: 'TEXT',
  number: 'REAL',
  integer: 'INTEGER',
  boolean: 'INTEGER',
  datetime: 'TEXT',
  json: 'TEXT',
};

// --- Implementation ---

export class SqliteStorage implements Storage {
  private db: BetterSqlite3.Database;
  public events: SqliteEventStorage;
  public queue: SqliteQueueStorage;
  public state: SqliteStateStorage;
  public relays: SqliteRelayStorage;
  public workflowTables: SqliteWorkflowTableStorage;

  constructor(dbPath: string, migrationsDir: string) {
    this.db = new BetterSqlite3(dbPath);

    // ADR-002: WAL mode + pragmas (devC implementation notes)
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');

    // Run migrations
    const applied = runMigrations(this.db, migrationsDir);
    if (applied > 0) {
      // Log will be handled by caller
    }

    this.events = new SqliteEventStorage(this.db);
    this.queue = new SqliteQueueStorage(this.db);
    this.state = new SqliteStateStorage(this.db);
    this.relays = new SqliteRelayStorage(this.db);
    this.workflowTables = new SqliteWorkflowTableStorage(this.db);
  }

  close(): void {
    this.db.close();
  }
}

// --- EventStorage ---

class SqliteEventStorage implements EventStorage {
  private stmts: {
    insert: BetterSqlite3.Statement;
    getById: BetterSqlite3.Statement;
    getBySourceId: BetterSqlite3.Statement;
    deleteOlderThan: BetterSqlite3.Statement;
  };

  constructor(private db: BetterSqlite3.Database) {
    this.stmts = {
      insert: db.prepare('INSERT INTO events (source, source_id, data) VALUES (?, ?, ?)'),
      getById: db.prepare('SELECT * FROM events WHERE id = ?'),
      getBySourceId: db.prepare('SELECT * FROM events WHERE source_id = ?'),
      deleteOlderThan: db.prepare('DELETE FROM events WHERE received_at < ?'),
    };
  }

  log(source: string, sourceId: string | null, data: unknown): number {
    const result = this.stmts.insert.run(source, sourceId, JSON.stringify(data));
    return Number(result.lastInsertRowid);
  }

  getById(id: number): StoredEvent | null {
    const row = this.stmts.getById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getBySourceId(sourceId: string): StoredEvent | null {
    const row = this.stmts.getBySourceId.get(sourceId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  deleteOlderThan(date: string): number {
    const result = this.stmts.deleteOlderThan.run(date);
    return result.changes;
  }

  private mapRow(row: Record<string, unknown>): StoredEvent {
    return {
      id: row.id as number,
      receivedAt: row.received_at as string,
      source: row.source as string,
      sourceId: row.source_id as string | null,
      data: JSON.parse(row.data as string),
    };
  }
}

// --- QueueStorage ---

class SqliteQueueStorage implements QueueStorage {
  private stmts: {
    enqueue: BetterSqlite3.Statement;
    dequeue: BetterSqlite3.Statement;
    markProcessing: BetterSqlite3.Statement;
    markComplete: BetterSqlite3.Statement;
    markFailed: BetterSqlite3.Statement;
    markDead: BetterSqlite3.Statement;
    getRetryable: BetterSqlite3.Statement;
    getById: BetterSqlite3.Statement;
  };

  constructor(private db: BetterSqlite3.Database) {
    this.stmts = {
      enqueue: db.prepare(`
        INSERT INTO queue (event_id, workflow_id, priority, max_attempts)
        VALUES (?, ?, ?, ?)
      `),
      dequeue: db.prepare(`
        UPDATE queue SET status = 'processing', updated_at = datetime('now')
        WHERE id = (
          SELECT id FROM queue
          WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
          ORDER BY priority DESC, created_at ASC
          LIMIT 1
        )
        RETURNING *
      `),
      markProcessing: db.prepare(`
        UPDATE queue SET status = 'processing', updated_at = datetime('now') WHERE id = ?
      `),
      markComplete: db.prepare(`
        UPDATE queue SET status = 'completed', result = ?, updated_at = datetime('now') WHERE id = ?
      `),
      markFailed: db.prepare(`
        UPDATE queue SET status = 'failed', error = ?, attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?
      `),
      markDead: db.prepare(`
        UPDATE queue SET status = 'dead', updated_at = datetime('now') WHERE id = ?
      `),
      getRetryable: db.prepare(`
        SELECT * FROM queue WHERE status = 'failed' AND attempts < max_attempts AND (next_retry_at IS NULL OR next_retry_at <= ?)
      `),
      getById: db.prepare('SELECT * FROM queue WHERE id = ?'),
    };
  }

  enqueue(eventId: number, workflowId: string, priority = 0, maxAttempts = 3): number {
    const result = this.stmts.enqueue.run(eventId, workflowId, priority, maxAttempts);
    return Number(result.lastInsertRowid);
  }

  dequeue(): QueuedEvent | null {
    // ADR-006: single-process, synchronous — no race condition possible
    const row = this.stmts.dequeue.get() as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  markProcessing(id: number): void {
    this.stmts.markProcessing.run(id);
  }

  markComplete(id: number, result: unknown): void {
    this.stmts.markComplete.run(JSON.stringify(result), id);
  }

  markFailed(id: number, error: string): void {
    this.stmts.markFailed.run(error, id);
  }

  markDead(id: number): void {
    this.stmts.markDead.run(id);
  }

  getRetryable(now: string): QueuedEvent[] {
    const rows = this.stmts.getRetryable.all(now) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  replayEvent(id: number): number {
    // ADR-011: re-inject the original event as a new queue entry
    const original = this.stmts.getById.get(id) as Record<string, unknown> | undefined;
    if (!original) throw new Error(`Queue entry ${id} not found`);

    const result = this.stmts.enqueue.run(
      original.event_id,
      original.workflow_id,
      original.priority ?? 0,
      original.max_attempts ?? 3,
    );
    return Number(result.lastInsertRowid);
  }

  private mapRow(row: Record<string, unknown>): QueuedEvent {
    return {
      id: row.id as number,
      eventId: row.event_id as number,
      workflowId: row.workflow_id as string,
      status: row.status as QueuedEvent['status'],
      priority: row.priority as number,
      attempts: row.attempts as number,
      maxAttempts: row.max_attempts as number,
      nextRetryAt: row.next_retry_at as string | null,
      result: row.result ? JSON.parse(row.result as string) : null,
      error: row.error as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}

// --- StateStorage ---

class SqliteStateStorage implements StateStorage {
  private stmts: {
    get: BetterSqlite3.Statement;
    upsert: BetterSqlite3.Statement;
    delete: BetterSqlite3.Statement;
    listByNamespace: BetterSqlite3.Statement;
  };

  constructor(private db: BetterSqlite3.Database) {
    this.stmts = {
      get: db.prepare('SELECT value FROM state WHERE namespace = ? AND key = ?'),
      upsert: db.prepare(`
        INSERT INTO state (namespace, key, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `),
      delete: db.prepare('DELETE FROM state WHERE namespace = ? AND key = ?'),
      listByNamespace: db.prepare('SELECT * FROM state WHERE namespace = ?'),
    };
  }

  get(namespace: string, key: string): unknown | null {
    const row = this.stmts.get.get(namespace, key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  set(namespace: string, key: string, value: unknown): void {
    this.stmts.upsert.run(namespace, key, JSON.stringify(value));
  }

  delete(namespace: string, key: string): boolean {
    const result = this.stmts.delete.run(namespace, key);
    return result.changes > 0;
  }

  listByNamespace(namespace: string): StateEntry[] {
    const rows = this.stmts.listByNamespace.all(namespace) as Record<string, unknown>[];
    return rows.map((row) => ({
      namespace: row.namespace as string,
      key: row.key as string,
      value: JSON.parse(row.value as string),
      updatedAt: row.updated_at as string,
    }));
  }
}

// --- RelayStorage ---

class SqliteRelayStorage implements RelayStorage {
  private stmts: {
    upsert: BetterSqlite3.Statement;
    getByUrl: BetterSqlite3.Statement;
    getActive: BetterSqlite3.Statement;
    incrementFailures: BetterSqlite3.Statement;
    resetFailures: BetterSqlite3.Statement;
    quarantine: BetterSqlite3.Statement;
  };

  constructor(private db: BetterSqlite3.Database) {
    this.stmts = {
      upsert: db.prepare(`
        INSERT INTO relays (url, status, failures, quarantine_until, meta, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(url) DO UPDATE SET
          status = excluded.status, failures = excluded.failures,
          quarantine_until = excluded.quarantine_until, meta = excluded.meta,
          updated_at = datetime('now')
      `),
      getByUrl: db.prepare('SELECT * FROM relays WHERE url = ?'),
      getActive: db.prepare("SELECT * FROM relays WHERE status = 'active'"),
      incrementFailures: db.prepare(`
        UPDATE relays SET failures = failures + 1, meta = json_set(COALESCE(meta, '{}'), '$.last_failure', ?), updated_at = datetime('now')
        WHERE url = ?
      `),
      resetFailures: db.prepare(`
        UPDATE relays SET failures = 0, status = 'active', quarantine_until = NULL, updated_at = datetime('now')
        WHERE url = ?
      `),
      quarantine: db.prepare(`
        UPDATE relays SET status = 'quarantined', quarantine_until = ?, updated_at = datetime('now')
        WHERE url = ?
      `),
    };
  }

  upsert(relay: RelayInfo): void {
    this.stmts.upsert.run(
      relay.url, relay.status, relay.failures,
      relay.quarantineUntil, JSON.stringify(relay.meta),
    );
  }

  getByUrl(url: string): RelayInfo | null {
    const row = this.stmts.getByUrl.get(url) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getActive(): RelayInfo[] {
    const rows = this.stmts.getActive.all() as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  incrementFailures(url: string, reason: string): void {
    this.stmts.incrementFailures.run(reason, url);
  }

  resetFailures(url: string): void {
    this.stmts.resetFailures.run(url);
  }

  quarantine(url: string, until: string): void {
    this.stmts.quarantine.run(until, url);
  }

  private mapRow(row: Record<string, unknown>): RelayInfo {
    return {
      url: row.url as string,
      status: row.status as RelayInfo['status'],
      failures: row.failures as number,
      quarantineUntil: row.quarantine_until as string | null,
      meta: row.meta ? JSON.parse(row.meta as string) : {},
      updatedAt: row.updated_at as string,
    };
  }
}

// --- WorkflowTableStorage (ADR-004) ---

class SqliteWorkflowTableStorage implements WorkflowTableStorage {
  constructor(private db: BetterSqlite3.Database) {}

  ensureTable(tableName: string, columns: Record<string, string>, primaryKey?: string | string[]): void {
    const fullName = `wf_${tableName}`;

    // Check if table exists
    const existing = this.getTableColumns(tableName);
    if (existing.length > 0) {
      // Table exists — additive only: add missing columns
      for (const [col, yamlType] of Object.entries(columns)) {
        if (!existing.includes(col)) {
          const sqlType = YAML_TO_SQLITE[yamlType] ?? 'TEXT';
          this.addColumn(tableName, col, sqlType);
        }
      }
      return;
    }

    // Create new table
    const colDefs: string[] = [];
    const pkCols = primaryKey
      ? (Array.isArray(primaryKey) ? primaryKey : [primaryKey])
      : null;

    // If no primary key declared, add auto-increment id
    if (!pkCols) {
      colDefs.push('id INTEGER PRIMARY KEY AUTOINCREMENT');
    }

    for (const [col, yamlType] of Object.entries(columns)) {
      const sqlType = YAML_TO_SQLITE[yamlType] ?? 'TEXT';
      colDefs.push(`${col} ${sqlType}`);
    }

    // Add primary key constraint
    if (pkCols) {
      colDefs.push(`PRIMARY KEY (${pkCols.join(', ')})`);
    }

    this.db.exec(`CREATE TABLE ${fullName} (${colDefs.join(', ')})`);
  }

  addColumn(tableName: string, columnName: string, columnType: string): void {
    const fullName = `wf_${tableName}`;
    this.db.exec(`ALTER TABLE ${fullName} ADD COLUMN ${columnName} ${columnType}`);
  }

  getTableColumns(tableName: string): string[] {
    const fullName = `wf_${tableName}`;
    try {
      const rows = this.db.prepare(`PRAGMA table_info(${fullName})`).all() as { name: string }[];
      return rows.map((r) => r.name);
    } catch {
      return [];
    }
  }

  listWorkflowTables(): string[] {
    const rows = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'wf_%'"
    ).all() as { name: string }[];
    return rows.map((r) => r.name.replace(/^wf_/, ''));
  }

  dropTable(tableName: string): void {
    const fullName = `wf_${tableName}`;
    this.db.exec(`DROP TABLE IF EXISTS ${fullName}`);
  }
}
