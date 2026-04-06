# ADR-003: Database schema design

**Status:** Accepted
**Date:** 2026-04-06
**Context:** v2 refactor based on devB/devA code review

## Problem

The current schema has 6 tables with 80+ columns total. Reviewers identified overlapping concerns, rigid column structures, and no migration system — making the schema hard to evolve without breaking things.

## Current state (v1)

| Table | Columns | Issue |
|-------|---------|-------|
| `event_log` | 16 | Mixes event reception with workflow execution tracking |
| `workflow_execution` | 12 | Overlaps with event_log (both track workflow results) |
| `event_queue` | 15 | Heavy, many nullable columns anticipating future needs |
| `workflow_state` | 12 | 4 typed value columns (number, string, json, boolean) — poor polymorphism |
| `workflow_state_history` | 11 | Separate audit table, heavy for the value it provides |
| `relay_state` | 12 | Reasonable but many rarely-queried columns |
| **Total** | **~80** | No migrations, schema frozen from day zero |

## Decision

**4 system tables, JSON columns for flexible data, versioned migrations.**

```sql
-- events: what arrived (append-only log)
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,        -- 'nostr', 'webhook', 'api', 'scheduler'
  source_id TEXT,              -- event id / request id
  data TEXT NOT NULL           -- JSON: full normalized event
);

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
  result TEXT,                 -- JSON: { actions: [{id, success, response, error}] }
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- state: persistent workflow state (balances, counters, flags)
CREATE TABLE state (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,         -- JSON: any value
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (namespace, key)
);

-- relays: relay health tracking
CREATE TABLE relays (
  url TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  failures INTEGER DEFAULT 0,
  quarantine_until TEXT,
  meta TEXT,                   -- JSON: last_success, last_error, discovered_from, etc.
  updated_at TEXT DEFAULT (datetime('now'))
);
-- indexes
CREATE INDEX idx_events_source_id ON events(source_id);
CREATE INDEX idx_events_received_at ON events(received_at);
CREATE INDEX idx_queue_dequeue ON queue(status, next_retry_at, priority DESC, created_at ASC);
CREATE INDEX idx_queue_event ON queue(event_id);
```

## Rationale

### Why 4 tables instead of 6

- **`event_log` + `workflow_execution` merged into `events` + `queue`.** `events` records what arrived (pure log). `queue` tracks processing state and results. No overlap — clear separation between "what happened" and "what to do about it."
- **`workflow_state` simplified.** Four typed value columns (number, string, json, boolean) replaced by a single JSON `value` column. Only one was ever used at a time — the polymorphism added complexity without benefit.
- **`workflow_state_history` dropped.** The `events` table serves as the audit trail. If history tracking is needed later, it can be added via migration.
- **`relay_state` simplified to `relays`.** Rarely-queried fields (discovered_from, first_seen_at, total_events_*) moved to a `meta` JSON column.

### Why JSON columns

- **Flexible without schema changes.** Adding a field to event data or relay metadata doesn't require a migration.
- **SQLite 3.38+ supports JSON natively.** `json_extract()`, indexes on JSON fields, all work.
- **Only used for truly flexible data.** Structured fields (status, priority, timestamps) remain proper columns for indexing and querying.

### Why versioned migrations

- **Schema must evolve.** devA: "Evolving the schema is problematic, maintainers will have to work their way around the day zero schema."
- **Migrations in `db/migrations/`, applied in order on startup.** `001-initial.sql`, `002-xxx.sql`, etc. Engine tracks which migrations have been applied.
- **No schema in the spec.** The schema lives in migration files only, as devA recommended.

### What about workflow-specific data?

These 4 tables cover the **system** needs (event logging, queue processing, relay health, generic state). But some workflows need their own structured data — for example, the zap balance tracker needs per-npub balances with efficient queries like "all users with balance > 1000."

The generic `state` table handles simple key-value cases, but structured queries on JSON values don't scale well. This raised the question: how should workflows declare and manage their own tables, separately from system tables?

This is addressed in [ADR-004 — Workflow tables](004-workflow-tables.md).

## Discussion trail

**Reviewer input:**
- devA (high-level review): "Implementation details such as SQLite or the schema are part of the specification. Evolving the schema is problematic."
- devA (specs:575): "Remove. It makes no sense to represent the [DB] model in the spec. This is bound to diverge."
- devA: The v1 schema was described as one of the weakest points — rigid, unmaintainable, frozen from day zero.
- devB (database.ts:256): "save() called unconditionally from execute(), even inside BEGIN..COMMIT blocks."
- devB (database.ts:655): "Race condition: two workers dequeue same event."

**Product context:**
The v1 schema was built incrementally during AI-assisted prototyping, optimizing for speed of feature delivery, not long-term maintainability. This explains how 6 tables with 80 columns accumulated without anyone questioning the structure until the external review.

**Claude proposal:**
Initially proposed "keep the same 6 tables, just cleaner" — essentially reproducing the day-zero schema problem reviewers flagged.

**Christophe (product owner) challenge:**
"Roos told me one of the weakest points was the database model, that seemed pretty unmaintainable. You don't see any of that? Do you challenge your propositions with those feedbacks to not reproduce those errors?" — Forced a proper re-examination of the schema instead of a superficial rename.

**Revised proposal:**
4 system tables (down from 6), JSON columns for flexible data, versioned migrations. Merged overlapping tables, eliminated poor polymorphism (4 typed value columns → single JSON), dropped premature audit table.

**Decision:**
Minimal schema with JSON flexibility and migration system. Schema lives in migration files only, never in the spec.

## Post-review (devC feedback)

**Indexes:** devC flagged that no indexes were defined. Added indexes on `events(source_id)`, `events(received_at)`, and a composite index on `queue` for the dequeue query.

**Retention policy:** The `events` table is append-only. On storage-constrained SBCs (16GB SD card), this will fill up. Retention should be configurable (`max_age_days`, `max_rows`, `max_size_mb`). A control workflow should warn the admin npub at 80% disk usage. At 90%+, the engine should auto-purge old completed events as a safety valve (engine-level, not workflow — because if the disk is full, the workflow can't send the warning). Before purging, an archive workflow can push old events to a cloud destination using existing handlers. See [ADR-007 — Archive pattern](007-archive-pattern.md).

**Dequeue race condition:** devB flagged a race condition in v1 where two async operations could dequeue the same event. In v2, single-process architecture with synchronous database access (better-sqlite3) eliminates this by design — no interleaving possible within a single event loop. The internal queue is explicitly scoped to single-process use. See [ADR-006 — Queue scope](006-queue-scope.md).

**Foreign keys:** SQLite has foreign keys disabled by default. `PRAGMA foreign_keys = ON` must be set at connection open. Implementation note, tracked here for completeness.
