/**
 * Storage port interfaces (ADR-005)
 *
 * All database access goes through these interfaces.
 * v2 ships with SqliteStorage. Future adapters (PostgreSQL, in-memory, null)
 * can be added without touching the engine.
 */

export interface QueuedEvent {
  id?: number;
  eventId: number;
  workflowId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead';
  priority: number;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  result: unknown | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredEvent {
  id: number;
  receivedAt: string;
  source: string;
  sourceId: string | null;
  data: unknown;
}

export interface RelayInfo {
  url: string;
  status: 'active' | 'quarantined' | 'blacklisted';
  failures: number;
  quarantineUntil: string | null;
  meta: Record<string, unknown>;
  updatedAt: string;
}

export interface StateEntry {
  namespace: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

// --- Port interfaces ---

export interface EventStorage {
  log(source: string, sourceId: string | null, data: unknown): number;
  getById(id: number): StoredEvent | null;
  getBySourceId(sourceId: string): StoredEvent | null;
  getRecentSourceIds(sinceDate: string): string[];
  deleteOlderThan(date: string): number;
}

export interface QueueStorage {
  enqueue(eventId: number, workflowId: string, priority?: number, maxAttempts?: number): number;
  dequeue(): QueuedEvent | null;
  markProcessing(id: number): void;
  markComplete(id: number, result: unknown): void;
  markFailed(id: number, error: string): void;
  markDead(id: number): void;
  getRetryable(now: string): QueuedEvent[];
  replayEvent(id: number): number;
}

export interface StateStorage {
  get(namespace: string, key: string): unknown | null;
  set(namespace: string, key: string, value: unknown): void;
  delete(namespace: string, key: string): boolean;
  listByNamespace(namespace: string): StateEntry[];
}

export interface RelayStorage {
  upsert(relay: RelayInfo): void;
  getByUrl(url: string): RelayInfo | null;
  getActive(): RelayInfo[];
  incrementFailures(url: string, reason: string): void;
  resetFailures(url: string): void;
  quarantine(url: string, until: string): void;
}

export interface WorkflowTableStorage {
  ensureTable(tableName: string, columns: Record<string, string>, primaryKey?: string | string[]): void;
  addColumn(tableName: string, columnName: string, columnType: string): void;
  getTableColumns(tableName: string): string[];
  listWorkflowTables(): string[];
  dropTable(tableName: string): void;
}

/**
 * Combined storage interface.
 * The engine depends on this, not on SQLite directly.
 */
export interface Storage {
  events: EventStorage;
  queue: QueueStorage;
  state: StateStorage;
  relays: RelayStorage;
  workflowTables: WorkflowTableStorage;
  close(): void;
}
