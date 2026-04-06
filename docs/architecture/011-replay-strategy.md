# ADR-011: Dead event replay strategy

**Status:** Accepted
**Date:** 2026-04-06
**Context:** Emerged from ADR-010 discussion — when a handler fails at execution, events become `dead` in the queue after retries. How to recover?

## Problem

A workflow has 3 actions: telegram (succeeds), email (fails — SMTP down), file log (never reached). After automatic retries are exhausted, the event is `dead`. The admin fixes the SMTP config. How do they re-process the event without losing the successful telegram result or sending duplicates?

## Options considered

| Option | How it works | Cost | Risk |
|---|---|---|---|
| **A: Full replay** | Re-run everything from scratch | ~10 lines | Duplicates (telegram fires again) |
| **B: Resume from failure** | Skip succeeded actions, resume at first failure | ~200+ lines, second execution engine | Bugs, context drift, alternate code path |
| **C: Re-inject event** | Put original event back in queue, workflow runs from scratch | ~15 lines | Duplicates |
| **C + idempotency** | Re-inject, but skip actions flagged as not safe to repeat if they already succeeded | ~50 lines | Minimal |

## Decision

**Option C now (pure re-injection). Idempotency flag later if users need duplicate protection.**

### v2 launch: pure re-injection

```bash
./scripts/pipelinostr.sh queue replay <event-id>
./scripts/pipelinostr.sh queue replay --status dead
```

The original event is re-injected into the queue. The workflow matches and runs from scratch. Same execution path, no special cases. Duplicates are accepted and documented.

### Later: idempotency guards (if needed)

Optional `idempotent` flag per action:

```yaml
actions:
  - id: notify_telegram
    type: telegram
    idempotent: false   # default — will re-execute on replay

  - id: log_to_file
    type: file
    idempotent: true    # safe to re-run, skip if already succeeded
```

On replay, the engine checks: if the action has `idempotent: false` AND it already succeeded in a previous run of this event, skip it. Everything else runs normally.

This is backward-compatible — defaults to `false` (re-run everything), so no migration needed.

## Rationale

- **Same code path.** No second execution engine. The replay goes through the exact same workflow matching and execution as a fresh event. One code path to test, one code path to debug.
- **Option B is a trap.** Context serialization, restoration, alternate execution path — ~200+ lines of code for a feature that serves an edge case. "For a project targeting DIY users on Orange Pis, this is unjustifiable complexity" (devC).
- **Duplicates are acceptable for v2.** A user fixing a broken SMTP config understands that telegram fires again — it's a notification, not a bank transfer. Document it, move on.
- **Idempotency flag is cheap insurance.** ~50 lines, one `if` per action, reuses existing per-action results stored in the queue. Ships only when real users hit duplicate pain.

## Discussion trail

**Product context:**
Workflow tracking (event logging, per-action results) was built in v1 specifically for this kind of recovery scenario. If telegram succeeds and email fails, the successful result should not be lost.

**Christophe (product owner) input:**
"If telegram is OK, email is KO, telegram info is received and logged, email is KO so workflow fails, but we should be able to re-run it once email handler is up again." — Established the need for replay.

Asked about manual vs automatic: automatic retries handle transient failures. Manual replay handles configuration fixes (dead events).

On replay strategy: "Something between B and C, but I don't know how to justify."

**devC review:**
"Option B sounds good but is a trap — it's a second execution engine." Proposed C + idempotency as the clean middle ground. "Ship pure C now, add idempotency flag later if users complain. Do not build Option B. Ever."

## Related ADRs

- [ADR-003 — Database schema](003-database-schema.md): Queue table stores per-action results, enabling replay decisions
- [ADR-006 — Queue scope](006-queue-scope.md): Single-process queue with retry semantics
- [ADR-010 — Handler registry](010-handler-registry.md): Handler failure at execution triggers workflow failure → event enters retry/dead cycle
