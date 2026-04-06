# ADR-006: Internal queue scoped to single-process execution

**Status:** Accepted
**Date:** 2026-04-06
**Context:** Emerged from ADR-003 discussion on dequeue race conditions

## Problem

devB flagged a race condition in v1: with async sql.js, two concurrent operations could dequeue the same event. The move to synchronous better-sqlite3 (ADR-002) eliminates this in single-process mode. But should the internal queue support multiple processes or workers in the future?

## Decision

**The internal SQLite queue is explicitly designed for single-process use only.** No distributed locking, no visibility timeout, no competing-consumer logic.

## Consequences

- **Simple, fast, no race conditions.** One process, one writer, one reader. Synchronous better-sqlite3 guarantees no interleaving within the event loop.
- **If the process dies, pending events wait until restart.** No other worker picks them up. This is acceptable for a self-hosted, single-node application.
- **No halfway measures.** The transition to multi-agent is binary: internal SQLite queue (single-process) OR external queue system (Redis Streams, NATS, PostgreSQL SKIP LOCKED, etc.) with dedicated workers. Do not extend the internal queue with file locks, row locking, or lease/heartbeat mechanisms.

When multi-agent processing is needed, the path forward is an external queue with dedicated workers — not extending the internal SQLite queue.

## Discussion trail

**Reviewer input:**
- devB (database.ts:655): "Any future async code between SELECT and UPDATE creates race condition (two workers dequeue same event)."

**Product context:**
PipeliNostr runs as a single Node.js process. The internal queue handles backpressure, retry, and ordering for one agent. Multi-agent is not a current need.

**Christophe (product owner) input:**
"Multiple-agent won't be for tomorrow. The day we'll need it, we need to maybe plan a multi-agent queue system, or a way to connect to a non-internal, better managed queue, and for multiple agents to share the work. But we can consider that internal queue is for a unique, self-runner agent." — Drew the line between internal (single-process, simple) and future external (multi-agent, dedicated system).

**devC review:**
Confirmed the ADR is warranted. "The real risk is NOT documenting it — someone adds a second process, hits silent double-processing, spends hours debugging." Recommended the transition be framed as binary: internal queue or external queue, nothing in between.
