# ADR-008: Workflow auditor (draft)

**Status:** Draft
**Date:** 2026-04-06
**Context:** Emerged from ADR-004 (workflow tables) discussion on storage coherence, and devA's review comment: "We need a workflow compiler, else a generated workflow may simply crash at runtime because of a static condition"

## Problem

Workflow authors (low-technical DIY users) write YAML configurations that can contain errors only visible at runtime — sometimes hours later when a specific event triggers the broken workflow. There is no validation beyond YAML parsing. Mistakes like referencing a nonexistent action, a missing handler, or incoherent storage declarations produce silent failures.

## Decision

**Ship a static workflow auditor that runs at startup (Phase 1). Plan a dry-run CLI mode for later (Phase 2).**

## How it works

### Phase 1 — Static lint (v2 day one)

Runs at startup after all workflows and handlers are loaded. Pure data inspection, no side effects, milliseconds to execute.

### Phase 2 — Dry-run (future)

On-demand via CLI. Instantiates a fake event, runs template engine, evaluates `when` clauses, validates rendered output against handler expectations. Slots into the same rule registry as Phase 1.

### CLI

```bash
./scripts/pipelinostr.sh workflow audit [id]    # audit one or all workflows
```

Same engine as startup, but on-demand. Lets the user validate a workflow before restarting the process.

## Severity model

| Severity | Behavior | Examples |
|----------|----------|---------|
| **ERROR** | Workflow is **disabled** at startup, others keep running | Missing handler, invalid YAML, forward-reference to nonexistent action |
| **WARN** | Log at warn level, workflow runs | Unused variable, hook target disabled, storage schema mismatch across workflows |

Never block the entire process. A user with 20 workflows should not lose all of them because one has a typo. The auditor force-disables the broken workflow with a clear reason.

**Zero false positives policy.** If a check cannot be certain, it stays silent or downgrades to debug-level. One wrong warning trains users to ignore the auditor entirely.

## Day one rules (Phase 1)

### Structural integrity

| Rule | Check | Severity |
|------|-------|----------|
| S-001 | YAML parses without error | ERROR |
| S-002 | Required fields present: `id`, `trigger`, `actions` (at least one) | ERROR |
| S-003 | Each action has a `type` that maps to a loaded handler | ERROR |
| S-004 | Action IDs are unique within the workflow | ERROR |

### Template references

| Rule | Check | Severity |
|------|-------|----------|
| T-001 | `{{ actions.X.response.* }}` — action X exists and is sequenced before the referencing action | ERROR |
| T-002 | `{{ variables.X }}` — X is declared in the workflow's `variables` block | WARN |
| T-003 | `{{ match.N }}` — trigger has a `content_pattern` with at least N capture groups | WARN |

### Hook coherence

| Rule | Check | Severity |
|------|-------|----------|
| H-001 | `on_complete` / `on_fail` / `on_start` reference workflow IDs that exist | ERROR |
| H-002 | `{{ parent.variables.X }}` used in a workflow never referenced as a hook target | WARN |
| H-003 | Hook chain contains a cycle (A → B → A) — static graph walk at startup | ERROR |
| H-004 | Hook chain depth exceeds `max_hook_depth` (configurable, default 10) | WARN |

### Storage coherence

| Rule | Check | Severity |
|------|-------|----------|
| D-001 | Two workflows sharing the same `storage` table have compatible schemas (same columns, same types) | WARN |
| D-002 | Workflow reads from a table with no declared primary key — warn that multiple rows may match | WARN |

Rules are identified by short IDs (S = structural, T = template, H = hooks, D = data/storage) for reference in docs and error messages.

## Extension model

New rules are added as they are discovered. Each rule follows the same pattern:

```typescript
interface AuditRule {
  id: string;            // e.g. "S-001"
  phase: 1 | 2;         // static or dry-run
  severity: 'error' | 'warn';
  check(workflows: WorkflowDefinition[], handlers: string[]): AuditResult[];
}
```

The rule registry is a simple array. Adding a new rule = adding one object. No framework redesign needed.

## Output

Structured log per violation:

```
[AUDIT] ERROR S-003: workflow "zap-notification" action "send" references handler "telegramm" — handler not found (did you mean "telegram"?)
[AUDIT] WARN  D-002: workflow "read-balance" reads from "wf_balances" which has no primary key — multiple rows may match
```

## Rationale

- **Huge product value for low cost.** ~10 rules catch ~80% of DIY user mistakes. The implementation is a few hundred lines — pure data inspection, no complex logic.
- **Non-exhaustive is fine.** The value curve is logarithmic. The auditor doesn't need to be a proof system. It catches the obvious mistakes that currently produce silent failures hours later.
- **Disable, don't block.** One broken workflow shouldn't take down 19 working ones. Matches the existing `enabled: true/false` model.
- **Grows over time.** Draft ADR because new rules will be added as real mistakes are discovered. The framework ships now; the exhaustive rule set is built through experience.

## Discussion trail

**Reviewer input:**
- devA (specs:876): "We need a workflow compiler, else a generated workflow may simply crash at runtime because of a static condition. In order to write an editor efficiently, a workflow compiler is required."

**Product context:**
PipeliNostr targets low-technical DIY users who write YAML workflows. A typo or logical error that only surfaces hours later when a specific event arrives is a frustrating and opaque experience.

**Christophe (product owner) insight:**
Raised the storage coherence example: Workflow A writes to `wf_balances` without a primary key, Workflow B reads assuming one row per npub — auditor should warn about incoherence. "For me it's a huge product value to have this, even if not exhaustive, on start."

**devC review:**
"Ship it. Phase 1 static lint at startup, ~10 deterministic rules, zero false positives policy, disable-not-block, draft ADR for the framework. It is one of those rare features where the implementation cost is low and the user-facing value is immediately tangible." Proposed the two-phase model (static lint now, dry-run later), the severity tiers, and the rule ID system.

## Related ADRs

- [ADR-004 — Workflow tables](004-workflow-tables.md): Storage coherence checks (D-001, D-002)
