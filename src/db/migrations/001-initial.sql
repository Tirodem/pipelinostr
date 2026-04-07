-- PipeliNostr v2 initial schema (ADR-003)
-- Applied by migration runner at startup

-- Migration tracking
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- events: what arrived (append-only log)
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,
  source_id TEXT,
  data TEXT NOT NULL
);

CREATE INDEX idx_events_source_id ON events(source_id);
CREATE INDEX idx_events_received_at ON events(received_at);

-- queue: what needs processing
CREATE TABLE queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  next_retry_at TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_queue_dequeue ON queue(status, next_retry_at, priority DESC, created_at ASC);
CREATE INDEX idx_queue_event ON queue(event_id);

-- state: persistent workflow state (balances, counters, flags)
CREATE TABLE state (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (namespace, key)
);

-- relays: relay health tracking
CREATE TABLE relays (
  url TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  failures INTEGER DEFAULT 0,
  quarantine_until TEXT,
  meta TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
