import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from './logger.js';
import type { EventLog } from './models/event-log.js';
import type { RelayState } from './models/relay-state.js';
import type { WorkflowExecution } from './models/workflow-execution.js';
import type { QueuedEvent, QueuedEventStatus, QueuedEventType, QueueStats, EnqueueOptions } from './models/queued-event.js';

export class PipelinostrDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      logger.info({ path: dir }, 'Created database directory');
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    logger.info({ path: dbPath }, 'Database connected');
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
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
      );

      CREATE INDEX IF NOT EXISTS idx_event_log_received_at ON event_log(received_at);
      CREATE INDEX IF NOT EXISTS idx_event_log_source ON event_log(source_type, source_identifier);
      CREATE INDEX IF NOT EXISTS idx_event_log_workflow ON event_log(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_event_log_status ON event_log(status);

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
      );

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
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_execution_event ON workflow_execution(event_log_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_execution_workflow ON workflow_execution(workflow_id);

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
      );

      CREATE INDEX IF NOT EXISTS idx_event_queue_status ON event_queue(status);
      CREATE INDEX IF NOT EXISTS idx_event_queue_next_retry ON event_queue(next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_event_queue_priority ON event_queue(priority DESC, created_at ASC);
    `);

    logger.debug('Database tables initialized');
  }

  // ==================== EventLog ====================

  insertEventLog(event: Omit<EventLog, 'id' | 'created_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO event_log (
        received_at, workflow_matched_at, workflow_started_at, workflow_completed_at,
        source_type, source_identifier, source_raw,
        workflow_id, workflow_name, status, retry_count, error_message,
        target_type, target_identifier, target_response
      ) VALUES (
        @received_at, @workflow_matched_at, @workflow_started_at, @workflow_completed_at,
        @source_type, @source_identifier, @source_raw,
        @workflow_id, @workflow_name, @status, @retry_count, @error_message,
        @target_type, @target_identifier, @target_response
      )
    `);

    const result = stmt.run({
      received_at: event.received_at.toISOString(),
      workflow_matched_at: event.workflow_matched_at?.toISOString() ?? null,
      workflow_started_at: event.workflow_started_at?.toISOString() ?? null,
      workflow_completed_at: event.workflow_completed_at?.toISOString() ?? null,
      source_type: event.source_type,
      source_identifier: event.source_identifier ?? null,
      source_raw: event.source_raw ?? null,
      workflow_id: event.workflow_id ?? null,
      workflow_name: event.workflow_name ?? null,
      status: event.status,
      retry_count: event.retry_count,
      error_message: event.error_message ?? null,
      target_type: event.target_type ?? null,
      target_identifier: event.target_identifier ?? null,
      target_response: event.target_response ?? null,
    });

    return result.lastInsertRowid as number;
  }

  updateEventLogStatus(
    id: number,
    status: EventLog['status'],
    updates?: Partial<Pick<EventLog, 'workflow_matched_at' | 'workflow_started_at' | 'workflow_completed_at' | 'error_message' | 'retry_count' | 'target_type' | 'target_identifier' | 'target_response' | 'workflow_id' | 'workflow_name'>>
  ): void {
    const fields = ['status = @status'];
    const params: Record<string, unknown> = { id, status };

    if (updates?.workflow_matched_at) {
      fields.push('workflow_matched_at = @workflow_matched_at');
      params['workflow_matched_at'] = updates.workflow_matched_at.toISOString();
    }
    if (updates?.workflow_started_at) {
      fields.push('workflow_started_at = @workflow_started_at');
      params['workflow_started_at'] = updates.workflow_started_at.toISOString();
    }
    if (updates?.workflow_completed_at) {
      fields.push('workflow_completed_at = @workflow_completed_at');
      params['workflow_completed_at'] = updates.workflow_completed_at.toISOString();
    }
    if (updates?.error_message !== undefined) {
      fields.push('error_message = @error_message');
      params['error_message'] = updates.error_message;
    }
    if (updates?.retry_count !== undefined) {
      fields.push('retry_count = @retry_count');
      params['retry_count'] = updates.retry_count;
    }
    if (updates?.workflow_id !== undefined) {
      fields.push('workflow_id = @workflow_id');
      params['workflow_id'] = updates.workflow_id;
    }
    if (updates?.workflow_name !== undefined) {
      fields.push('workflow_name = @workflow_name');
      params['workflow_name'] = updates.workflow_name;
    }
    if (updates?.target_type !== undefined) {
      fields.push('target_type = @target_type');
      params['target_type'] = updates.target_type;
    }
    if (updates?.target_identifier !== undefined) {
      fields.push('target_identifier = @target_identifier');
      params['target_identifier'] = updates.target_identifier;
    }
    if (updates?.target_response !== undefined) {
      fields.push('target_response = @target_response');
      params['target_response'] = updates.target_response;
    }

    const stmt = this.db.prepare(`UPDATE event_log SET ${fields.join(', ')} WHERE id = @id`);
    stmt.run(params);
  }

  getEventLog(id: number): EventLog | undefined {
    const stmt = this.db.prepare('SELECT * FROM event_log WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToEventLog(row) : undefined;
  }

  getRecentEventLogs(limit = 100, offset = 0): EventLog[] {
    const stmt = this.db.prepare('SELECT * FROM event_log ORDER BY received_at DESC LIMIT ? OFFSET ?');
    const rows = stmt.all(limit, offset) as Record<string, unknown>[];
    return rows.map((row) => this.rowToEventLog(row));
  }

  getEventLogsByStatus(status: EventLog['status'], limit = 100): EventLog[] {
    const stmt = this.db.prepare('SELECT * FROM event_log WHERE status = ? ORDER BY received_at DESC LIMIT ?');
    const rows = stmt.all(status, limit) as Record<string, unknown>[];
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
    const stmt = this.db.prepare(`
      INSERT INTO relay_state (
        url, status, consecutive_failures, last_success_at, last_failure_at,
        last_failure_reason, quarantine_until, quarantine_level,
        total_events_received, total_events_sent, discovered_from,
        first_seen_at, updated_at
      ) VALUES (
        @url, @status, @consecutive_failures, @last_success_at, @last_failure_at,
        @last_failure_reason, @quarantine_until, @quarantine_level,
        @total_events_received, @total_events_sent, @discovered_from,
        @first_seen_at, @updated_at
      )
      ON CONFLICT(url) DO UPDATE SET
        status = @status,
        consecutive_failures = @consecutive_failures,
        last_success_at = @last_success_at,
        last_failure_at = @last_failure_at,
        last_failure_reason = @last_failure_reason,
        quarantine_until = @quarantine_until,
        quarantine_level = @quarantine_level,
        total_events_received = @total_events_received,
        total_events_sent = @total_events_sent,
        updated_at = @updated_at
    `);

    stmt.run({
      url: relay.url,
      status: relay.status,
      consecutive_failures: relay.consecutive_failures,
      last_success_at: relay.last_success_at?.toISOString() ?? null,
      last_failure_at: relay.last_failure_at?.toISOString() ?? null,
      last_failure_reason: relay.last_failure_reason ?? null,
      quarantine_until: relay.quarantine_until?.toISOString() ?? null,
      quarantine_level: relay.quarantine_level,
      total_events_received: relay.total_events_received,
      total_events_sent: relay.total_events_sent,
      discovered_from: relay.discovered_from,
      first_seen_at: relay.first_seen_at.toISOString(),
      updated_at: relay.updated_at.toISOString(),
    });
  }

  getRelayState(url: string): RelayState | undefined {
    const stmt = this.db.prepare('SELECT * FROM relay_state WHERE url = ?');
    const row = stmt.get(url) as Record<string, unknown> | undefined;
    return row ? this.rowToRelayState(row) : undefined;
  }

  getAllRelayStates(): RelayState[] {
    const stmt = this.db.prepare('SELECT * FROM relay_state ORDER BY url');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToRelayState(row));
  }

  getActiveRelays(): RelayState[] {
    const stmt = this.db.prepare(`
      SELECT * FROM relay_state
      WHERE status = 'active'
      OR (status = 'quarantined' AND quarantine_until < datetime('now'))
      ORDER BY url
    `);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToRelayState(row));
  }

  incrementRelayEventCount(url: string, type: 'received' | 'sent'): void {
    const field = type === 'received' ? 'total_events_received' : 'total_events_sent';
    const stmt = this.db.prepare(`
      UPDATE relay_state
      SET ${field} = ${field} + 1, updated_at = datetime('now')
      WHERE url = ?
    `);
    stmt.run(url);
  }

  recordRelaySuccess(url: string): void {
    const stmt = this.db.prepare(`
      UPDATE relay_state SET
        status = 'active',
        consecutive_failures = 0,
        last_success_at = datetime('now'),
        quarantine_until = NULL,
        quarantine_level = 0,
        updated_at = datetime('now')
      WHERE url = ?
    `);
    stmt.run(url);
  }

  recordRelayFailure(url: string, reason: string, quarantineUntil?: Date, quarantineLevel?: number): void {
    const stmt = this.db.prepare(`
      UPDATE relay_state SET
        status = CASE WHEN @quarantine_until IS NOT NULL THEN 'quarantined' ELSE status END,
        consecutive_failures = consecutive_failures + 1,
        last_failure_at = datetime('now'),
        last_failure_reason = @reason,
        quarantine_until = @quarantine_until,
        quarantine_level = COALESCE(@quarantine_level, quarantine_level),
        updated_at = datetime('now')
      WHERE url = @url
    `);
    stmt.run({
      url,
      reason,
      quarantine_until: quarantineUntil?.toISOString() ?? null,
      quarantine_level: quarantineLevel ?? null,
    });
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
    const stmt = this.db.prepare(`
      INSERT INTO workflow_execution (
        event_log_id, workflow_id, action_id, action_type,
        started_at, completed_at, status, attempt_number,
        input_data, output_data, error_message
      ) VALUES (
        @event_log_id, @workflow_id, @action_id, @action_type,
        @started_at, @completed_at, @status, @attempt_number,
        @input_data, @output_data, @error_message
      )
    `);

    const result = stmt.run({
      event_log_id: execution.event_log_id ?? null,
      workflow_id: execution.workflow_id,
      action_id: execution.action_id,
      action_type: execution.action_type,
      started_at: execution.started_at.toISOString(),
      completed_at: execution.completed_at?.toISOString() ?? null,
      status: execution.status,
      attempt_number: execution.attempt_number,
      input_data: execution.input_data ?? null,
      output_data: execution.output_data ?? null,
      error_message: execution.error_message ?? null,
    });

    return result.lastInsertRowid as number;
  }

  updateWorkflowExecution(
    id: number,
    updates: Partial<Pick<WorkflowExecution, 'completed_at' | 'status' | 'output_data' | 'error_message'>>
  ): void {
    const fields: string[] = [];
    const params: Record<string, unknown> = { id };

    if (updates.completed_at) {
      fields.push('completed_at = @completed_at');
      params['completed_at'] = updates.completed_at.toISOString();
    }
    if (updates.status) {
      fields.push('status = @status');
      params['status'] = updates.status;
    }
    if (updates.output_data !== undefined) {
      fields.push('output_data = @output_data');
      params['output_data'] = updates.output_data;
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = @error_message');
      params['error_message'] = updates.error_message;
    }

    if (fields.length > 0) {
      const stmt = this.db.prepare(`UPDATE workflow_execution SET ${fields.join(', ')} WHERE id = @id`);
      stmt.run(params);
    }
  }

  getWorkflowExecutions(eventLogId: number): WorkflowExecution[] {
    const stmt = this.db.prepare('SELECT * FROM workflow_execution WHERE event_log_id = ? ORDER BY started_at');
    const rows = stmt.all(eventLogId) as Record<string, unknown>[];
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

    const stmt = this.db.prepare(`
      INSERT INTO event_queue (
        event_type, event_id, event_data, priority, max_retries, next_retry_at
      ) VALUES (
        @event_type, @event_id, @event_data, @priority, @max_retries, @next_retry_at
      )
    `);

    const result = stmt.run({
      event_type: eventType,
      event_id: eventId ?? null,
      event_data: JSON.stringify(eventData),
      priority: options.priority ?? 0,
      max_retries: options.max_retries ?? 3,
      next_retry_at: nextRetryAt?.toISOString() ?? null,
    });

    return result.lastInsertRowid as number;
  }

  // Get next event to process (respects priority and retry timing)
  dequeueEvent(): QueuedEvent | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM event_queue
      WHERE status = 'pending'
        AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `);

    const row = stmt.get() as Record<string, unknown> | undefined;
    if (!row) return undefined;

    // Mark as processing
    const updateStmt = this.db.prepare(`
      UPDATE event_queue
      SET status = 'processing', started_at = datetime('now')
      WHERE id = ?
    `);
    updateStmt.run(row['id']);

    return this.rowToQueuedEvent(row);
  }

  // Mark event as completed
  ackEvent(id: number, workflowId?: string, workflowName?: string, resultData?: unknown): void {
    const stmt = this.db.prepare(`
      UPDATE event_queue
      SET status = 'completed',
          completed_at = datetime('now'),
          workflow_id = @workflow_id,
          workflow_name = @workflow_name,
          result_data = @result_data
      WHERE id = @id
    `);

    stmt.run({
      id,
      workflow_id: workflowId ?? null,
      workflow_name: workflowName ?? null,
      result_data: resultData ? JSON.stringify(resultData) : null,
    });
  }

  // Mark event as failed (will retry if under max_retries)
  nackEvent(id: number, errorMessage: string, requeue = true): void {
    // Get current event to check retry count
    const event = this.getQueuedEvent(id);
    if (!event) return;

    const newRetryCount = event.retry_count + 1;
    const shouldRetry = requeue && newRetryCount < event.max_retries;

    // Exponential backoff: 2^retry * 1000ms (1s, 2s, 4s, 8s, 16s...)
    const backoffMs = Math.min(Math.pow(2, newRetryCount) * 1000, 300000); // Max 5 minutes
    const nextRetryAt = new Date(Date.now() + backoffMs);

    const newStatus: QueuedEventStatus = shouldRetry ? 'pending' : (newRetryCount >= event.max_retries ? 'dead' : 'failed');

    const stmt = this.db.prepare(`
      UPDATE event_queue
      SET status = @status,
          retry_count = @retry_count,
          next_retry_at = @next_retry_at,
          error_message = @error_message,
          completed_at = CASE WHEN @status IN ('failed', 'dead') THEN datetime('now') ELSE NULL END
      WHERE id = @id
    `);

    stmt.run({
      id,
      status: newStatus,
      retry_count: newRetryCount,
      next_retry_at: shouldRetry ? nextRetryAt.toISOString() : null,
      error_message: errorMessage,
    });

    if (shouldRetry) {
      logger.debug({ id, retryCount: newRetryCount, nextRetryAt }, 'Event requeued for retry');
    } else {
      logger.warn({ id, retryCount: newRetryCount, status: newStatus }, 'Event moved to dead letter');
    }
  }

  getQueuedEvent(id: number): QueuedEvent | undefined {
    const stmt = this.db.prepare('SELECT * FROM event_queue WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToQueuedEvent(row) : undefined;
  }

  getQueuedEventsByStatus(status: QueuedEventStatus, limit = 100): QueuedEvent[] {
    const stmt = this.db.prepare('SELECT * FROM event_queue WHERE status = ? ORDER BY created_at DESC LIMIT ?');
    const rows = stmt.all(status, limit) as Record<string, unknown>[];
    return rows.map((row) => this.rowToQueuedEvent(row));
  }

  getRecentQueuedEvents(limit = 100): QueuedEvent[] {
    const stmt = this.db.prepare('SELECT * FROM event_queue ORDER BY created_at DESC LIMIT ?');
    const rows = stmt.all(limit) as Record<string, unknown>[];
    return rows.map((row) => this.rowToQueuedEvent(row));
  }

  // Replay a failed/dead event
  replayEvent(id: number): boolean {
    const event = this.getQueuedEvent(id);
    if (!event || (event.status !== 'failed' && event.status !== 'dead')) {
      return false;
    }

    const stmt = this.db.prepare(`
      UPDATE event_queue
      SET status = 'pending',
          retry_count = 0,
          next_retry_at = NULL,
          started_at = NULL,
          completed_at = NULL,
          error_message = NULL
      WHERE id = ?
    `);
    stmt.run(id);

    logger.info({ id }, 'Event replayed');
    return true;
  }

  // Replay all failed events
  replayFailedEvents(): number {
    const stmt = this.db.prepare(`
      UPDATE event_queue
      SET status = 'pending',
          retry_count = 0,
          next_retry_at = NULL,
          started_at = NULL,
          completed_at = NULL,
          error_message = NULL
      WHERE status IN ('failed', 'dead')
    `);
    const result = stmt.run();
    const count = result.changes;

    if (count > 0) {
      logger.info({ count }, 'Failed events replayed');
    }
    return count;
  }

  // Get queue statistics
  getQueueStats(): QueueStats {
    const stmt = this.db.prepare(`
      SELECT
        status,
        COUNT(*) as count
      FROM event_queue
      GROUP BY status
    `);
    const rows = stmt.all() as Array<{ status: string; count: number }>;

    const stats: QueueStats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      dead: 0,
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

  // Clean up old completed events (keep last N days)
  cleanupQueue(keepDays = 7): number {
    const stmt = this.db.prepare(`
      DELETE FROM event_queue
      WHERE status = 'completed'
        AND completed_at < datetime('now', '-' || ? || ' days')
    `);
    const result = stmt.run(keepDays);
    return result.changes;
  }

  // Reset stuck processing events (for recovery after crash)
  resetStuckEvents(stuckMinutes = 10): number {
    const stmt = this.db.prepare(`
      UPDATE event_queue
      SET status = 'pending',
          started_at = NULL
      WHERE status = 'processing'
        AND started_at < datetime('now', '-' || ? || ' minutes')
    `);
    const result = stmt.run(stuckMinutes);

    if (result.changes > 0) {
      logger.warn({ count: result.changes }, 'Reset stuck events');
    }
    return result.changes;
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

  // ==================== Utilities ====================

  close(): void {
    this.db.close();
    logger.info('Database connection closed');
  }

  getStats(): { events: number; relays: number; executions: number; queue: QueueStats } {
    const events = (this.db.prepare('SELECT COUNT(*) as count FROM event_log').get() as { count: number }).count;
    const relays = (this.db.prepare('SELECT COUNT(*) as count FROM relay_state').get() as { count: number }).count;
    const executions = (this.db.prepare('SELECT COUNT(*) as count FROM workflow_execution').get() as { count: number }).count;
    const queue = this.getQueueStats();
    return { events, relays, executions, queue };
  }
}

let dbInstance: PipelinostrDatabase | null = null;

export function initDatabase(dbPath: string): PipelinostrDatabase {
  if (dbInstance) {
    return dbInstance;
  }
  dbInstance = new PipelinostrDatabase(dbPath);
  return dbInstance;
}

export function getDatabase(): PipelinostrDatabase {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}
