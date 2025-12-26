import initSqlJs, { Database as SqlJsDatabase, BindParams, SqlValue } from 'sql.js';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from './logger.js';
import type { EventLog } from './models/event-log.js';
import type { RelayState } from './models/relay-state.js';
import type { WorkflowExecution } from './models/workflow-execution.js';
import type { QueuedEvent, QueuedEventStatus, QueuedEventType, QueueStats, EnqueueOptions } from './models/queued-event.js';
import type { WorkflowState, WorkflowStateHistory, WorkflowStateInput, IncrementOptions, DecrementOptions } from './models/workflow-state.js';

export class PipelinostrDatabase {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingSave = false;

  private constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  static async create(dbPath: string): Promise<PipelinostrDatabase> {
    const instance = new PipelinostrDatabase(dbPath);
    await instance.initialize();
    return instance;
  }

  private async initialize(): Promise<void> {
    // Ensure directory exists
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      logger.info({ path: dir }, 'Created database directory');
    }

    // Initialize sql.js
    const SQL = await initSqlJs();

    // Load existing database or create new
    if (existsSync(this.dbPath)) {
      const fileBuffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
      logger.info({ path: this.dbPath }, 'Database loaded from file');
    } else {
      this.db = new SQL.Database();
      logger.info({ path: this.dbPath }, 'New database created');
    }

    // Enable foreign keys
    this.db.run('PRAGMA foreign_keys = ON');

    this.initializeTables();
    this.save(); // Save initial state
  }

  private save(): void {
    // Debounce saves to avoid too many writes
    if (this.saveTimeout) {
      this.pendingSave = true;
      return;
    }

    this.pendingSave = false;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);

    // Set timeout to batch subsequent saves
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      if (this.pendingSave) {
        this.save();
      }
    }, 100);
  }

  private initializeTables(): void {
    this.db.run(`
      -- Table principale : log de tous les events traités
      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        workflow_matched_at DATETIME,
        workflow_started_at DATETIME,
        workflow_completed_at DATETIME,
        source_type TEXT NOT NULL,
        source_identifier TEXT,
        source_raw TEXT,
        workflow_id TEXT,
        workflow_name TEXT,
        status TEXT NOT NULL DEFAULT 'received',
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        target_type TEXT,
        target_identifier TEXT,
        target_response TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_event_log_received_at ON event_log(received_at)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_event_log_source ON event_log(source_type, source_identifier)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_event_log_workflow ON event_log(workflow_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_event_log_status ON event_log(status)');

    this.db.run(`
      -- Table état des relays
      CREATE TABLE IF NOT EXISTS relay_state (
        url TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active',
        consecutive_failures INTEGER DEFAULT 0,
        last_success_at DATETIME,
        last_failure_at DATETIME,
        last_failure_reason TEXT,
        quarantine_until DATETIME,
        quarantine_level INTEGER DEFAULT 0,
        total_events_received INTEGER DEFAULT 0,
        total_events_sent INTEGER DEFAULT 0,
        discovered_from TEXT NOT NULL,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`
      -- Table exécutions de workflows (détail)
      CREATE TABLE IF NOT EXISTS workflow_execution (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_log_id INTEGER REFERENCES event_log(id),
        workflow_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        started_at DATETIME NOT NULL,
        completed_at DATETIME,
        status TEXT NOT NULL,
        attempt_number INTEGER DEFAULT 1,
        input_data TEXT,
        output_data TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_workflow_execution_event ON workflow_execution(event_log_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_workflow_execution_workflow ON workflow_execution(workflow_id)');

    this.db.run(`
      -- Table file d'attente des événements
      CREATE TABLE IF NOT EXISTS event_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        event_id TEXT,
        event_data TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER DEFAULT 0,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        next_retry_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        completed_at DATETIME,
        workflow_id TEXT,
        workflow_name TEXT,
        error_message TEXT,
        result_data TEXT
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_event_queue_status ON event_queue(status)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_event_queue_next_retry ON event_queue(next_retry_at)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_event_queue_priority ON event_queue(priority DESC, created_at ASC)');

    this.db.run(`
      -- Table état des workflows (balances, compteurs, flags)
      CREATE TABLE IF NOT EXISTS workflow_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT NOT NULL,
        namespace TEXT NOT NULL DEFAULT 'default',
        state_key TEXT NOT NULL,
        value_type TEXT NOT NULL DEFAULT 'number',
        value_number REAL,
        value_string TEXT,
        value_json TEXT,
        value_boolean INTEGER,
        source_event_id TEXT,
        event_log_id INTEGER,
        source_pubkey TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(namespace, state_key)
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_workflow_state_lookup ON workflow_state(namespace, state_key)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_workflow_state_pubkey ON workflow_state(source_pubkey)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_workflow_state_updated ON workflow_state(updated_at)');

    this.db.run(`
      -- Table historique des modifications d'état
      CREATE TABLE IF NOT EXISTS workflow_state_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_id INTEGER NOT NULL,
        operation TEXT NOT NULL,
        old_value_number REAL,
        old_value_string TEXT,
        new_value_number REAL,
        new_value_string TEXT,
        delta REAL,
        source_event_id TEXT,
        source_pubkey TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_state_history_state ON workflow_state_history(state_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_state_history_time ON workflow_state_history(created_at)');

    logger.debug('Database tables initialized');
  }

  // Helper to run a query and get all results as objects
  private queryAll<T>(sql: string, params: BindParams = []): T[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  // Helper to run a query and get first result
  private queryOne<T>(sql: string, params: BindParams = []): T | undefined {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    let result: T | undefined;
    if (stmt.step()) {
      result = stmt.getAsObject() as T;
    }
    stmt.free();
    return result;
  }

  // Helper to run an insert and return lastInsertRowid
  private insert(sql: string, params: BindParams = []): number {
    this.db.run(sql, params);
    const result = this.queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
    this.save();
    return result?.id ?? 0;
  }

  // Helper to run an update/delete and return changes count
  private execute(sql: string, params: BindParams = []): number {
    this.db.run(sql, params);
    const result = this.queryOne<{ changes: number }>('SELECT changes() as changes');
    this.save();
    return result?.changes ?? 0;
  }

  // ==================== EventLog ====================

  insertEventLog(event: Omit<EventLog, 'id' | 'created_at'>): number {
    return this.insert(`
      INSERT INTO event_log (
        received_at, workflow_matched_at, workflow_started_at, workflow_completed_at,
        source_type, source_identifier, source_raw,
        workflow_id, workflow_name, status, retry_count, error_message,
        target_type, target_identifier, target_response
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      event.received_at.toISOString(),
      event.workflow_matched_at?.toISOString() ?? null,
      event.workflow_started_at?.toISOString() ?? null,
      event.workflow_completed_at?.toISOString() ?? null,
      event.source_type,
      event.source_identifier ?? null,
      event.source_raw ?? null,
      event.workflow_id ?? null,
      event.workflow_name ?? null,
      event.status,
      event.retry_count,
      event.error_message ?? null,
      event.target_type ?? null,
      event.target_identifier ?? null,
      event.target_response ?? null,
    ]);
  }

  updateEventLogStatus(
    id: number,
    status: EventLog['status'],
    updates?: Partial<Pick<EventLog, 'workflow_matched_at' | 'workflow_started_at' | 'workflow_completed_at' | 'error_message' | 'retry_count' | 'target_type' | 'target_identifier' | 'target_response' | 'workflow_id' | 'workflow_name'>>
  ): void {
    const fields = ['status = ?'];
    const params: SqlValue[] = [status];

    if (updates?.workflow_matched_at) {
      fields.push('workflow_matched_at = ?');
      params.push(updates.workflow_matched_at.toISOString());
    }
    if (updates?.workflow_started_at) {
      fields.push('workflow_started_at = ?');
      params.push(updates.workflow_started_at.toISOString());
    }
    if (updates?.workflow_completed_at) {
      fields.push('workflow_completed_at = ?');
      params.push(updates.workflow_completed_at.toISOString());
    }
    if (updates?.error_message !== undefined) {
      fields.push('error_message = ?');
      params.push(updates.error_message);
    }
    if (updates?.retry_count !== undefined) {
      fields.push('retry_count = ?');
      params.push(updates.retry_count);
    }
    if (updates?.workflow_id !== undefined) {
      fields.push('workflow_id = ?');
      params.push(updates.workflow_id);
    }
    if (updates?.workflow_name !== undefined) {
      fields.push('workflow_name = ?');
      params.push(updates.workflow_name);
    }
    if (updates?.target_type !== undefined) {
      fields.push('target_type = ?');
      params.push(updates.target_type);
    }
    if (updates?.target_identifier !== undefined) {
      fields.push('target_identifier = ?');
      params.push(updates.target_identifier);
    }
    if (updates?.target_response !== undefined) {
      fields.push('target_response = ?');
      params.push(updates.target_response);
    }

    params.push(id);
    this.execute(`UPDATE event_log SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  getEventLog(id: number): EventLog | undefined {
    const row = this.queryOne<Record<string, unknown>>('SELECT * FROM event_log WHERE id = ?', [id]);
    return row ? this.rowToEventLog(row) : undefined;
  }

  getRecentEventLogs(limit = 100, offset = 0): EventLog[] {
    const rows = this.queryAll<Record<string, unknown>>('SELECT * FROM event_log ORDER BY received_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    return rows.map((row) => this.rowToEventLog(row));
  }

  getEventLogsByStatus(status: EventLog['status'], limit = 100): EventLog[] {
    const rows = this.queryAll<Record<string, unknown>>('SELECT * FROM event_log WHERE status = ? ORDER BY received_at DESC LIMIT ?', [status, limit]);
    return rows.map((row) => this.rowToEventLog(row));
  }

  private rowToEventLog(row: Record<string, unknown>): EventLog {
    return {
      id: row['id'] as number,
      received_at: new Date(row['received_at'] as string),
      workflow_matched_at: row['workflow_matched_at'] ? new Date(row['workflow_matched_at'] as string) : undefined,
      workflow_started_at: row['workflow_started_at'] ? new Date(row['workflow_started_at'] as string) : undefined,
      workflow_completed_at: row['workflow_completed_at'] ? new Date(row['workflow_completed_at'] as string) : undefined,
      source_type: row['source_type'] as string,
      source_identifier: row['source_identifier'] as string | undefined,
      source_raw: row['source_raw'] as string | undefined,
      workflow_id: row['workflow_id'] as string | undefined,
      workflow_name: row['workflow_name'] as string | undefined,
      status: row['status'] as EventLog['status'],
      retry_count: row['retry_count'] as number,
      error_message: row['error_message'] as string | undefined,
      target_type: row['target_type'] as string | undefined,
      target_identifier: row['target_identifier'] as string | undefined,
      target_response: row['target_response'] as string | undefined,
      created_at: new Date(row['created_at'] as string),
    };
  }

  // ==================== RelayState ====================

  upsertRelayState(relay: RelayState): void {
    // Check if exists
    const existing = this.queryOne<Record<string, unknown>>('SELECT url FROM relay_state WHERE url = ?', [relay.url]);

    if (existing) {
      this.execute(`
        UPDATE relay_state SET
          status = ?, consecutive_failures = ?, last_success_at = ?, last_failure_at = ?,
          last_failure_reason = ?, quarantine_until = ?, quarantine_level = ?,
          total_events_received = ?, total_events_sent = ?, updated_at = ?
        WHERE url = ?
      `, [
        relay.status,
        relay.consecutive_failures,
        relay.last_success_at?.toISOString() ?? null,
        relay.last_failure_at?.toISOString() ?? null,
        relay.last_failure_reason ?? null,
        relay.quarantine_until?.toISOString() ?? null,
        relay.quarantine_level,
        relay.total_events_received,
        relay.total_events_sent,
        relay.updated_at.toISOString(),
        relay.url,
      ]);
    } else {
      this.insert(`
        INSERT INTO relay_state (
          url, status, consecutive_failures, last_success_at, last_failure_at,
          last_failure_reason, quarantine_until, quarantine_level,
          total_events_received, total_events_sent, discovered_from,
          first_seen_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        relay.url,
        relay.status,
        relay.consecutive_failures,
        relay.last_success_at?.toISOString() ?? null,
        relay.last_failure_at?.toISOString() ?? null,
        relay.last_failure_reason ?? null,
        relay.quarantine_until?.toISOString() ?? null,
        relay.quarantine_level,
        relay.total_events_received,
        relay.total_events_sent,
        relay.discovered_from,
        relay.first_seen_at.toISOString(),
        relay.updated_at.toISOString(),
      ]);
    }
  }

  getRelayState(url: string): RelayState | undefined {
    const row = this.queryOne<Record<string, unknown>>('SELECT * FROM relay_state WHERE url = ?', [url]);
    return row ? this.rowToRelayState(row) : undefined;
  }

  getAllRelayStates(): RelayState[] {
    const rows = this.queryAll<Record<string, unknown>>('SELECT * FROM relay_state ORDER BY url');
    return rows.map((row) => this.rowToRelayState(row));
  }

  getActiveRelays(): RelayState[] {
    const rows = this.queryAll<Record<string, unknown>>(`
      SELECT * FROM relay_state
      WHERE status = 'active'
      OR (status = 'quarantined' AND quarantine_until < datetime('now'))
      ORDER BY url
    `);
    return rows.map((row) => this.rowToRelayState(row));
  }

  incrementRelayEventCount(url: string, type: 'received' | 'sent'): void {
    const field = type === 'received' ? 'total_events_received' : 'total_events_sent';
    this.execute(`UPDATE relay_state SET ${field} = ${field} + 1, updated_at = datetime('now') WHERE url = ?`, [url]);
  }

  recordRelaySuccess(url: string): void {
    this.execute(`
      UPDATE relay_state SET
        status = 'active',
        consecutive_failures = 0,
        last_success_at = datetime('now'),
        quarantine_until = NULL,
        quarantine_level = 0,
        updated_at = datetime('now')
      WHERE url = ?
    `, [url]);
  }

  recordRelayFailure(url: string, reason: string, quarantineUntil?: Date, quarantineLevel?: number): void {
    if (quarantineUntil) {
      this.execute(`
        UPDATE relay_state SET
          status = 'quarantined',
          consecutive_failures = consecutive_failures + 1,
          last_failure_at = datetime('now'),
          last_failure_reason = ?,
          quarantine_until = ?,
          quarantine_level = ?,
          updated_at = datetime('now')
        WHERE url = ?
      `, [reason, quarantineUntil.toISOString(), quarantineLevel ?? 0, url]);
    } else {
      this.execute(`
        UPDATE relay_state SET
          consecutive_failures = consecutive_failures + 1,
          last_failure_at = datetime('now'),
          last_failure_reason = ?,
          updated_at = datetime('now')
        WHERE url = ?
      `, [reason, url]);
    }
  }

  private rowToRelayState(row: Record<string, unknown>): RelayState {
    return {
      url: row['url'] as string,
      status: row['status'] as RelayState['status'],
      consecutive_failures: row['consecutive_failures'] as number,
      last_success_at: row['last_success_at'] ? new Date(row['last_success_at'] as string) : undefined,
      last_failure_at: row['last_failure_at'] ? new Date(row['last_failure_at'] as string) : undefined,
      last_failure_reason: row['last_failure_reason'] as string | undefined,
      quarantine_until: row['quarantine_until'] ? new Date(row['quarantine_until'] as string) : undefined,
      quarantine_level: row['quarantine_level'] as number,
      total_events_received: row['total_events_received'] as number,
      total_events_sent: row['total_events_sent'] as number,
      discovered_from: row['discovered_from'] as RelayState['discovered_from'],
      first_seen_at: new Date(row['first_seen_at'] as string),
      updated_at: new Date(row['updated_at'] as string),
    };
  }

  // ==================== WorkflowExecution ====================

  insertWorkflowExecution(execution: Omit<WorkflowExecution, 'id' | 'created_at'>): number {
    return this.insert(`
      INSERT INTO workflow_execution (
        event_log_id, workflow_id, action_id, action_type,
        started_at, completed_at, status, attempt_number,
        input_data, output_data, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      execution.event_log_id ?? null,
      execution.workflow_id,
      execution.action_id,
      execution.action_type,
      execution.started_at.toISOString(),
      execution.completed_at?.toISOString() ?? null,
      execution.status,
      execution.attempt_number,
      execution.input_data ?? null,
      execution.output_data ?? null,
      execution.error_message ?? null,
    ]);
  }

  updateWorkflowExecution(
    id: number,
    updates: Partial<Pick<WorkflowExecution, 'completed_at' | 'status' | 'output_data' | 'error_message'>>
  ): void {
    const fields: string[] = [];
    const params: SqlValue[] = [];

    if (updates.completed_at) {
      fields.push('completed_at = ?');
      params.push(updates.completed_at.toISOString());
    }
    if (updates.status) {
      fields.push('status = ?');
      params.push(updates.status);
    }
    if (updates.output_data !== undefined) {
      fields.push('output_data = ?');
      params.push(updates.output_data);
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      params.push(updates.error_message);
    }

    if (fields.length > 0) {
      params.push(id);
      this.execute(`UPDATE workflow_execution SET ${fields.join(', ')} WHERE id = ?`, params);
    }
  }

  getWorkflowExecutions(eventLogId: number): WorkflowExecution[] {
    const rows = this.queryAll<Record<string, unknown>>('SELECT * FROM workflow_execution WHERE event_log_id = ? ORDER BY started_at', [eventLogId]);
    return rows.map((row) => this.rowToWorkflowExecution(row));
  }

  private rowToWorkflowExecution(row: Record<string, unknown>): WorkflowExecution {
    return {
      id: row['id'] as number,
      event_log_id: row['event_log_id'] as number,
      workflow_id: row['workflow_id'] as string,
      action_id: row['action_id'] as string,
      action_type: row['action_type'] as string,
      started_at: new Date(row['started_at'] as string),
      completed_at: row['completed_at'] ? new Date(row['completed_at'] as string) : undefined,
      status: row['status'] as WorkflowExecution['status'],
      attempt_number: row['attempt_number'] as number,
      input_data: row['input_data'] as string | undefined,
      output_data: row['output_data'] as string | undefined,
      error_message: row['error_message'] as string | undefined,
      created_at: new Date(row['created_at'] as string),
    };
  }

  // ==================== EventQueue ====================

  enqueueEvent(
    eventType: QueuedEventType,
    eventData: unknown,
    eventId?: string,
    options: EnqueueOptions = {}
  ): number {
    const nextRetryAt = options.delay_ms
      ? new Date(Date.now() + options.delay_ms)
      : null;

    return this.insert(`
      INSERT INTO event_queue (
        event_type, event_id, event_data, priority, max_retries, next_retry_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      eventType,
      eventId ?? null,
      JSON.stringify(eventData),
      options.priority ?? 0,
      options.max_retries ?? 3,
      nextRetryAt?.toISOString() ?? null,
    ]);
  }

  recordHookExecution(
    eventData: unknown,
    eventId: string,
    status: 'completed' | 'failed',
    workflowId?: string,
    workflowName?: string,
    errorMessage?: string,
    resultData?: unknown
  ): number {
    return this.insert(`
      INSERT INTO event_queue (
        event_type, event_id, event_data, status, started_at, completed_at,
        workflow_id, workflow_name, error_message, result_data
      ) VALUES ('hook', ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?)
    `, [
      eventId,
      JSON.stringify(eventData),
      status,
      workflowId ?? null,
      workflowName ?? null,
      errorMessage ?? null,
      resultData ? JSON.stringify(resultData) : null,
    ]);
  }

  dequeueEvent(): QueuedEvent | undefined {
    const row = this.queryOne<Record<string, unknown>>(`
      SELECT * FROM event_queue
      WHERE status = 'pending'
        AND (next_retry_at IS NULL OR datetime(next_retry_at) <= datetime('now'))
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `);

    if (!row) return undefined;

    // Mark as processing
    this.execute(`UPDATE event_queue SET status = 'processing', started_at = datetime('now') WHERE id = ?`, [row['id'] as number]);

    return this.rowToQueuedEvent(row);
  }

  ackEvent(id: number, workflowId?: string, workflowName?: string, resultData?: unknown): void {
    this.execute(`
      UPDATE event_queue SET
        status = 'completed',
        completed_at = datetime('now'),
        workflow_id = ?,
        workflow_name = ?,
        result_data = ?
      WHERE id = ?
    `, [
      workflowId ?? null,
      workflowName ?? null,
      resultData ? JSON.stringify(resultData) : null,
      id,
    ]);
  }

  markEventStatus(
    id: number,
    status: QueuedEventStatus,
    workflowId?: string,
    workflowName?: string,
    resultData?: unknown
  ): void {
    this.execute(`
      UPDATE event_queue SET
        status = ?,
        completed_at = datetime('now'),
        workflow_id = ?,
        workflow_name = ?,
        result_data = ?
      WHERE id = ?
    `, [
      status,
      workflowId ?? null,
      workflowName ?? null,
      resultData ? JSON.stringify(resultData) : null,
      id,
    ]);
  }

  nackEvent(id: number, errorMessage: string, requeue = true): void {
    const event = this.getQueuedEvent(id);
    if (!event) return;

    const newRetryCount = event.retry_count + 1;
    const shouldRetry = requeue && newRetryCount < event.max_retries;
    const backoffMs = Math.min(Math.pow(2, newRetryCount) * 1000, 300000);
    const nextRetryAt = new Date(Date.now() + backoffMs);
    const newStatus: QueuedEventStatus = shouldRetry ? 'pending' : (newRetryCount >= event.max_retries ? 'dead' : 'failed');

    if (shouldRetry) {
      this.execute(`
        UPDATE event_queue SET
          status = ?,
          retry_count = ?,
          next_retry_at = ?,
          error_message = ?
        WHERE id = ?
      `, [newStatus, newRetryCount, nextRetryAt.toISOString(), errorMessage, id]);
      logger.debug({ id, retryCount: newRetryCount, nextRetryAt }, 'Event requeued for retry');
    } else {
      this.execute(`
        UPDATE event_queue SET
          status = ?,
          retry_count = ?,
          completed_at = datetime('now'),
          error_message = ?
        WHERE id = ?
      `, [newStatus, newRetryCount, errorMessage, id]);
      logger.warn({ id, retryCount: newRetryCount, status: newStatus }, 'Event moved to dead letter');
    }
  }

  getQueuedEvent(id: number): QueuedEvent | undefined {
    const row = this.queryOne<Record<string, unknown>>('SELECT * FROM event_queue WHERE id = ?', [id]);
    return row ? this.rowToQueuedEvent(row) : undefined;
  }

  getQueuedEventsByStatus(status: QueuedEventStatus, limit = 100): QueuedEvent[] {
    const rows = this.queryAll<Record<string, unknown>>('SELECT * FROM event_queue WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, limit]);
    return rows.map((row) => this.rowToQueuedEvent(row));
  }

  getRecentQueuedEvents(limit = 100): QueuedEvent[] {
    const rows = this.queryAll<Record<string, unknown>>('SELECT * FROM event_queue ORDER BY created_at DESC LIMIT ?', [limit]);
    return rows.map((row) => this.rowToQueuedEvent(row));
  }

  replayEvent(id: number): boolean {
    const event = this.getQueuedEvent(id);
    if (!event || (event.status !== 'failed' && event.status !== 'dead')) {
      return false;
    }

    this.execute(`
      UPDATE event_queue SET
        status = 'pending',
        retry_count = 0,
        next_retry_at = NULL,
        started_at = NULL,
        completed_at = NULL,
        error_message = NULL
      WHERE id = ?
    `, [id]);

    logger.info({ id }, 'Event replayed');
    return true;
  }

  replayFailedEvents(): number {
    const count = this.execute(`
      UPDATE event_queue SET
        status = 'pending',
        retry_count = 0,
        next_retry_at = NULL,
        started_at = NULL,
        completed_at = NULL,
        error_message = NULL
      WHERE status IN ('failed', 'dead')
    `);

    if (count > 0) {
      logger.info({ count }, 'Failed events replayed');
    }
    return count;
  }

  getQueueStats(): QueueStats {
    const rows = this.queryAll<{ status: string; count: number }>(`
      SELECT status, COUNT(*) as count FROM event_queue GROUP BY status
    `);

    const stats: QueueStats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      dead: 0,
      no_match: 0,
      skipped_disabled: 0,
      total: 0,
    };

    for (const row of rows) {
      const status = row.status as keyof QueueStats;
      if (status in stats && status !== 'total') {
        stats[status] = row.count;
        stats.total += row.count;
      }
    }

    return stats;
  }

  cleanupQueue(keepDays = 7): number {
    return this.execute(`
      DELETE FROM event_queue
      WHERE status = 'completed'
        AND completed_at < datetime('now', '-' || ? || ' days')
    `, [keepDays]);
  }

  resetStuckEvents(stuckMinutes = 10): number {
    const count = this.execute(`
      UPDATE event_queue SET
        status = 'pending',
        started_at = NULL
      WHERE status = 'processing'
        AND started_at < datetime('now', '-' || ? || ' minutes')
    `, [stuckMinutes]);

    if (count > 0) {
      logger.warn({ count }, 'Reset stuck events');
    }
    return count;
  }

  private rowToQueuedEvent(row: Record<string, unknown>): QueuedEvent {
    return {
      id: row['id'] as number,
      event_type: row['event_type'] as QueuedEventType,
      event_id: row['event_id'] as string | undefined,
      event_data: row['event_data'] as string,
      status: row['status'] as QueuedEventStatus,
      priority: row['priority'] as number,
      retry_count: row['retry_count'] as number,
      max_retries: row['max_retries'] as number,
      next_retry_at: row['next_retry_at'] ? new Date(row['next_retry_at'] as string) : undefined,
      created_at: new Date(row['created_at'] as string),
      started_at: row['started_at'] ? new Date(row['started_at'] as string) : undefined,
      completed_at: row['completed_at'] ? new Date(row['completed_at'] as string) : undefined,
      workflow_id: row['workflow_id'] as string | undefined,
      workflow_name: row['workflow_name'] as string | undefined,
      error_message: row['error_message'] as string | undefined,
      result_data: row['result_data'] as string | undefined,
    };
  }

  // ==================== WorkflowState ====================

  getState(_workflowId: string, namespace: string, key: string): WorkflowState | undefined {
    const row = this.queryOne<Record<string, unknown>>(`
      SELECT * FROM workflow_state WHERE namespace = ? AND state_key = ?
    `, [namespace, key]);
    return row ? this.rowToWorkflowState(row) : undefined;
  }

  setState(input: WorkflowStateInput): number {
    const existing = this.queryOne<Record<string, unknown>>(`
      SELECT id FROM workflow_state WHERE namespace = ? AND state_key = ?
    `, [input.namespace ?? 'default', input.state_key]);

    if (existing) {
      this.execute(`
        UPDATE workflow_state SET
          workflow_id = ?,
          value_type = ?,
          value_number = ?,
          value_string = ?,
          value_json = ?,
          value_boolean = ?,
          source_event_id = ?,
          event_log_id = ?,
          source_pubkey = ?,
          updated_at = datetime('now')
        WHERE namespace = ? AND state_key = ?
      `, [
        input.workflow_id,
        input.value_type ?? 'number',
        input.value_number ?? null,
        input.value_string ?? null,
        input.value_json ? JSON.stringify(input.value_json) : null,
        input.value_boolean !== undefined ? (input.value_boolean ? 1 : 0) : null,
        input.source_event_id ?? null,
        input.event_log_id ?? null,
        input.source_pubkey ?? null,
        input.namespace ?? 'default',
        input.state_key,
      ]);
      return existing['id'] as number;
    } else {
      return this.insert(`
        INSERT INTO workflow_state (
          workflow_id, namespace, state_key, value_type,
          value_number, value_string, value_json, value_boolean,
          source_event_id, event_log_id, source_pubkey
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        input.workflow_id,
        input.namespace ?? 'default',
        input.state_key,
        input.value_type ?? 'number',
        input.value_number ?? null,
        input.value_string ?? null,
        input.value_json ? JSON.stringify(input.value_json) : null,
        input.value_boolean !== undefined ? (input.value_boolean ? 1 : 0) : null,
        input.source_event_id ?? null,
        input.event_log_id ?? null,
        input.source_pubkey ?? null,
      ]);
    }
  }

  deleteState(_workflowId: string, namespace: string, key: string): boolean {
    const count = this.execute(`DELETE FROM workflow_state WHERE namespace = ? AND state_key = ?`, [namespace, key]);
    return count > 0;
  }

  incrementState(
    workflowId: string,
    namespace: string,
    key: string,
    amount: number,
    options: IncrementOptions = {}
  ): { success: boolean; value: number; previous: number; error_code?: string } {
    const { create_if_missing = true, default_value = 0, max_value, source_event_id, source_pubkey, track_history = false } = options;

    // Manual transaction
    this.db.run('BEGIN TRANSACTION');
    try {
      let current = this.getState(workflowId, namespace, key);
      const oldValue = current?.value_number ?? default_value;

      if (!current && create_if_missing) {
        this.setState({
          workflow_id: workflowId,
          namespace,
          state_key: key,
          value_type: 'number',
          value_number: default_value,
          source_event_id,
          source_pubkey,
        });
        current = this.getState(workflowId, namespace, key);
      }

      if (!current) {
        this.db.run('ROLLBACK');
        return { success: false, value: 0, previous: 0, error_code: 'NOT_FOUND' };
      }

      const newValue = oldValue + amount;

      if (max_value !== undefined && newValue > max_value) {
        this.db.run('ROLLBACK');
        return { success: false, value: oldValue, previous: oldValue, error_code: 'LIMIT_EXCEEDED' };
      }

      this.execute(`
        UPDATE workflow_state SET
          value_number = ?,
          source_event_id = COALESCE(?, source_event_id),
          source_pubkey = COALESCE(?, source_pubkey),
          updated_at = datetime('now')
        WHERE id = ?
      `, [newValue, source_event_id ?? null, source_pubkey ?? null, current.id]);

      if (track_history) {
        this.insertStateHistory({
          state_id: current.id,
          operation: 'increment',
          old_value_number: oldValue,
          new_value_number: newValue,
          delta: amount,
          source_event_id,
          source_pubkey,
        });
      }

      this.db.run('COMMIT');
      return { success: true, value: newValue, previous: oldValue };
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  decrementState(
    workflowId: string,
    namespace: string,
    key: string,
    amount: number,
    options: DecrementOptions = {}
  ): { success: boolean; value: number; previous: number; error_code?: string } {
    const { min_value = 0, source_event_id, source_pubkey, track_history = false } = options;

    this.db.run('BEGIN TRANSACTION');
    try {
      const current = this.getState(workflowId, namespace, key);

      if (!current) {
        this.db.run('ROLLBACK');
        return { success: false, value: 0, previous: 0, error_code: 'NOT_FOUND' };
      }

      const oldValue = current.value_number ?? 0;
      const newValue = oldValue - amount;

      if (newValue < min_value) {
        this.db.run('ROLLBACK');
        return { success: false, value: oldValue, previous: oldValue, error_code: 'INSUFFICIENT_BALANCE' };
      }

      this.execute(`
        UPDATE workflow_state SET
          value_number = ?,
          source_event_id = COALESCE(?, source_event_id),
          source_pubkey = COALESCE(?, source_pubkey),
          updated_at = datetime('now')
        WHERE id = ?
      `, [newValue, source_event_id ?? null, source_pubkey ?? null, current.id]);

      if (track_history) {
        this.insertStateHistory({
          state_id: current.id,
          operation: 'decrement',
          old_value_number: oldValue,
          new_value_number: newValue,
          delta: -amount,
          source_event_id,
          source_pubkey,
        });
      }

      this.db.run('COMMIT');
      return { success: true, value: newValue, previous: oldValue };
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  listStates(_workflowId: string, namespace?: string, keyPattern?: string, limit = 100): WorkflowState[] {
    let sql = 'SELECT * FROM workflow_state WHERE 1=1';
    const params: SqlValue[] = [];

    if (namespace) {
      sql += ' AND namespace = ?';
      params.push(namespace);
    }

    if (keyPattern) {
      sql += ' AND state_key LIKE ?';
      params.push(keyPattern);
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.queryAll<Record<string, unknown>>(sql, params);
    return rows.map((row) => this.rowToWorkflowState(row));
  }

  private insertStateHistory(history: Omit<WorkflowStateHistory, 'id' | 'created_at'>): number {
    return this.insert(`
      INSERT INTO workflow_state_history (
        state_id, operation, old_value_number, old_value_string,
        new_value_number, new_value_string, delta,
        source_event_id, source_pubkey
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      history.state_id,
      history.operation,
      history.old_value_number ?? null,
      history.old_value_string ?? null,
      history.new_value_number ?? null,
      history.new_value_string ?? null,
      history.delta ?? null,
      history.source_event_id ?? null,
      history.source_pubkey ?? null,
    ]);
  }

  getStateHistory(stateId: number, limit = 100): WorkflowStateHistory[] {
    const rows = this.queryAll<Record<string, unknown>>(`
      SELECT * FROM workflow_state_history WHERE state_id = ? ORDER BY created_at DESC LIMIT ?
    `, [stateId, limit]);
    return rows.map((row) => this.rowToWorkflowStateHistory(row));
  }

  private rowToWorkflowState(row: Record<string, unknown>): WorkflowState {
    return {
      id: row['id'] as number,
      workflow_id: row['workflow_id'] as string,
      namespace: row['namespace'] as string,
      state_key: row['state_key'] as string,
      value_type: row['value_type'] as WorkflowState['value_type'],
      value_number: row['value_number'] as number | undefined,
      value_string: row['value_string'] as string | undefined,
      value_json: row['value_json'] ? JSON.parse(row['value_json'] as string) : undefined,
      value_boolean: row['value_boolean'] !== null ? Boolean(row['value_boolean']) : undefined,
      source_event_id: row['source_event_id'] as string | undefined,
      event_log_id: row['event_log_id'] as number | undefined,
      source_pubkey: row['source_pubkey'] as string | undefined,
      created_at: new Date(row['created_at'] as string),
      updated_at: new Date(row['updated_at'] as string),
    };
  }

  private rowToWorkflowStateHistory(row: Record<string, unknown>): WorkflowStateHistory {
    return {
      id: row['id'] as number,
      state_id: row['state_id'] as number,
      operation: row['operation'] as WorkflowStateHistory['operation'],
      old_value_number: row['old_value_number'] as number | undefined,
      old_value_string: row['old_value_string'] as string | undefined,
      new_value_number: row['new_value_number'] as number | undefined,
      new_value_string: row['new_value_string'] as string | undefined,
      delta: row['delta'] as number | undefined,
      source_event_id: row['source_event_id'] as string | undefined,
      source_pubkey: row['source_pubkey'] as string | undefined,
      created_at: new Date(row['created_at'] as string),
    };
  }

  // ==================== Utilities ====================

  close(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    // Force final save
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
    this.db.close();
    logger.info('Database connection closed');
  }

  getStats(): { events: number; relays: number; executions: number; queue: QueueStats } {
    const events = this.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM event_log')?.count ?? 0;
    const relays = this.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM relay_state')?.count ?? 0;
    const executions = this.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM workflow_execution')?.count ?? 0;
    const queue = this.getQueueStats();
    return { events, relays, executions, queue };
  }
}

let dbInstance: PipelinostrDatabase | null = null;

export async function initDatabase(dbPath: string): Promise<PipelinostrDatabase> {
  if (dbInstance) {
    return dbInstance;
  }
  dbInstance = await PipelinostrDatabase.create(dbPath);
  return dbInstance;
}

export function getDatabase(): PipelinostrDatabase {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}
