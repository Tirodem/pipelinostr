# ADR-005: Storage port interface

**Status:** Accepted
**Date:** 2026-04-06
**Context:** Emerged from ADR-002 discussion — devC flagged ARM compilation risk for better-sqlite3, Christophe asked "should it be viable to add a database-less behavior?"

## Problem

better-sqlite3 is the right database engine (ADR-002), but two future scenarios require the database layer to be swappable:
1. **Lightweight mode** — simple GPIO workflows on constrained SBCs that don't need persistence
2. **Alternative database** — switching to PostgreSQL or another engine if the project outgrows SQLite

If SQLite is imported directly throughout the codebase, enabling either scenario requires a full refactor.

## Decision

**Database is mandatory in v2. All database access goes through a storage port interface so the implementation can be swapped later without rewriting the engine.**

## What this means

```typescript
// src/storage/storage.port.ts
interface QueueStorage {
  enqueue(event: QueuedEvent): void;
  dequeue(): QueuedEvent | null;
  markComplete(id: string, result: unknown): void;
  markFailed(id: string, error: string): void;
}

interface StateStorage {
  get(namespace: string, key: string): unknown;
  set(namespace: string, key: string, value: unknown): void;
}

interface EventStorage {
  log(event: NormalizedEvent): number;
  getById(id: number): StoredEvent | null;
}
```

v2 ships one implementation: `SqliteStorage` backed by better-sqlite3. The interfaces exist so future adapters (PostgreSQL, in-memory, null) can be added without touching the engine.

## What this is NOT

- Not a plugin system. No dynamic loading, no config toggle for "which database."
- Not a database abstraction layer (no ORM). The interfaces are thin and specific to PipeliNostr's needs.
- Not building the lightweight mode. No `NullStorage`, no `persistence: false` config. Just the interface boundary.

## Cost

~2 hours. Define the interfaces, refactor SQLite calls to go through them, inject the implementation at startup. Good architecture regardless of whether alternative adapters ever ship.

## Rationale

- **Keeps the door open cheaply.** The storage port is the only architectural prep needed now to enable database-less mode or a database engine switch later.
- **Prevents scattered direct imports.** Without the interface, `better-sqlite3` calls spread across queue, state, events, relay modules. Refactoring later is expensive.
- **Good architecture regardless.** Even if no alternative adapter is ever built, the interface makes testing easier (mock storage in unit tests) and enforces separation of concerns.

## Discussion trail

**Product context:**
Not every PipeliNostr use case requires persistence. A simple "zap → GPIO servo" workflow needs no queue, no history, no state. On very constrained SBCs, the database may be unnecessary overhead.

**Christophe (product owner) question:**
"Should it be viable to add a database-less behavior? Not every use requires a database."

**devC review:**
"Deferred. Do not build database-less mode for v2 launch. One thing to do now: define a storage port interface. This is the only thing you must do now. It costs maybe 2 hours and it's good architecture regardless." Proposed the two-adapter model: SqliteStorage now, NullStorage or InMemoryStorage later. Recommended calling it `persistence: false` or `mode: lightweight`, not "database-less."

**Decision:**
Storage port interface ships with v2. Database remains mandatory. Lightweight mode is a future feature enabled by this interface.

## Related ADRs

- [ADR-002 — Database engine](002-database-engine.md): better-sqlite3 choice that motivated this interface
- [ADR-007 — Archive pattern](007-archive-pattern.md): Archival uses outbound handlers, not the storage port — confirmed as correctly scoped
