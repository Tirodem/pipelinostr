# ADR-014: Process lifecycle and graceful shutdown

**Status:** Accepted
**Date:** 2026-04-06
**Context:** devB flagged re-entrance issues on shutdown, process.exit before async completion, and stuck handlers blocking the queue worker indefinitely. Handler authors (per ADR-010) need clear lifecycle contracts.

## Problem

v1 has no shutdown coordination: 4 signal handlers all call `shutdown()` without guarding re-entrance, `process.exit(0)` fires before async cleanup completes, and a stuck handler can block the process indefinitely.

## Decision

**Single shutdown gate, ordered teardown, timeout contracts for handler authors.**

### Shutdown order

1. **Inbound** — stop accepting events (close Nostr subscriptions, close HTTP server)
2. **Queue worker** — stop polling, wait for in-flight item to finish (with timeout)
3. **Handlers** — call `handler.shutdown()` on all initialized handlers, in parallel, each with its own timeout
4. **Database** — close SQLite connection last

### Single shutdown gate

- Boolean `shuttingDown` flag guards entry. Second signal is ignored.
- No `process.exit()` inside `shutdown()`. Let the event loop drain.
- After 10s of a second signal (e.g. user hits Ctrl+C twice): force `process.exit(1)`.

### Timeout contracts

| Scope | Default | Behavior on timeout |
|---|---|---|
| Per-handler `shutdown()` | 5s | Log warning, move on to next handler |
| Per-item execution (queue) | 30s | Cancel item, mark as failed, continue shutdown |
| Global shutdown | 15s | Force `process.exit(1)` |

All timeouts configurable in `config.yml`.

### Rules for handler authors

- **`shutdown()` must be idempotent** — safe to call twice.
- **Must resolve within the timeout.** Clean up connections and timers, don't start new work.
- **Never call `process.exit()`** from a handler.
- **Track long-running work.** If your handler spawns child processes, streams, or timers, cancel them in `shutdown()`.

### Queue worker liveness

- Worker checks `shuttingDown` between items — no new item picked up after shutdown starts.
- Per-item execution timeout (30s) prevents a stuck handler from blocking shutdown.

## Rationale

- **Handler authors have a clear contract** before they write code: idempotent shutdown, respect the timeout, no `process.exit`.
- **Shutdown order follows the dependency chain:** stop producing (inbound) before you stop consuming (queue) before you close infrastructure (handlers, DB).
- **One stuck handler can't hold the process.** Per-handler timeout moves on, global timeout force-exits.
- **~30 lines of orchestration code.** No structural change to handlers — they already have `shutdown()` methods.

## Discussion trail

**Reviewer input:**
- devB (index.ts:1): "No re-entrance guard on shutdown. 4 signal handlers all call shutdown() without checking if already running."
- devB (index.ts:1): "process.exit(0) before async completion."
- devB (queue-worker.ts:135): "If any handler is stuck, activeProcessing never reaches 0 and stop() loops forever."

**Christophe (product owner) input:**
"I'd rather a very light ADR to put the foundation of better handler writing, to not reproduce that." — Established this as a handler author guideline, not just a bug fix.

**devC review:**
Proposed the shutdown order (inbound → queue → handlers → DB), the timeout contracts, and the 4 handler author rules. "Intentionally thin — prescribes the rules, not the implementation details."

## Related ADRs

- [ADR-010 — Handler registry](010-handler-registry.md): Handlers implement initialize/execute/shutdown lifecycle
- [ADR-006 — Queue scope](006-queue-scope.md): Single-process queue, worker must respect shutdown
