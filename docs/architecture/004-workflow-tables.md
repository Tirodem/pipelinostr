# ADR-004: Workflow-specific tables

**Status:** Accepted
**Date:** 2026-04-06
**Context:** v2 refactor based on devA/devB code review

## Problem

Some workflows need persistent structured data beyond simple key-value state (e.g., zap balance tracker with per-npub balances). How should workflow-specific tables be managed, and how should they relate to system tables?

## Options considered

| Option | How it works | Pros | Cons |
|--------|-------------|------|------|
| **A: Generic state table** | All workflow data in `state` (namespace/key/JSON). JSON indexes for queries | Simple, no new tables | Can't do structured queries efficiently at scale. No separation between system and workflow data |
| **B: Workflow ships SQL migration files** | Workflow author writes `.sql` files in `db/migrations/` | Full SQL power, proper columns/indexes | Workflow author needs SQL knowledge. Two files in two places for one workflow. Orphan tables on workflow deletion. Migration ordering conflicts |
| **C: Declarative `storage:` in workflow YAML** | Workflow declares table schema in YAML. Engine auto-creates and manages the table | Lives with the workflow. No SQL required. Engine manages lifecycle. Clean system/workflow separation | Engine must handle schema diffing (solved by additive-only policy) |

## Decision

**Option C: Declarative `storage:` block in workflow YAML, with additive-only schema management.**

## How it works

### Workflow author declares storage needs:

```yaml
id: zap-balance-tracker
name: Zap Balance Tracker

storage:
  table: balances
  columns:
    npub: string
    amount: number
    last_zap: datetime
  primary_key: npub        # one row per npub, upsert on write
  indexes: [amount]

trigger:
  kinds: [9735]

actions:
  - id: update_balance
    type: workflow_db
    # ...
```

### Primary key behavior

| Declaration | Result |
|---|---|
| No `primary_key` | Engine adds `id INTEGER PRIMARY KEY AUTOINCREMENT` (append-only use cases) |
| `primary_key: npub` | `npub` is the PRIMARY KEY, no auto-id. Writes use upsert (update existing row or insert new one) |
| `primary_key: [npub, event_type]` | Composite primary key |

The `primary_key` field references columns declared in `columns`. The workflow auditor validates this at load time (see [ADR-008](008-workflow-auditor.md)).

### Engine behavior:

| Engine detects | Action | Destructive? |
|----------------|--------|-------------|
| Table doesn't exist | `CREATE TABLE wf_balances (...)` | No |
| New column in YAML | `ALTER TABLE wf_balances ADD COLUMN ...` | No |
| Column removed from YAML | Do nothing, column stays | No |
| `storage:` block removed | Do nothing, table stays as orphan | No |
| Column type changed | Log warning, do nothing | No |

**The engine only performs additive operations. It never deletes, renames, or alters destructively.**

### Cleanup:

Orphan tables and unused columns are harmless dead weight. To clean up explicitly:

```bash
./scripts/pipelinostr.sh db clean
```

This command lists orphaned `wf_*` tables and unused columns, asks for confirmation before dropping anything.

### Row-level operations

Row-level operations (read, write, upsert, delete) are handled by the `workflow_db` handler. See handler documentation for supported operations.

### Index syntax

- `indexes: [npub, amount]` → two separate single-column indexes
- `indexes: [[npub, amount]]` → one compound index on (npub, amount)
- Both can coexist: `indexes: [npub, [amount, last_zap]]`

### Shared tables

Workflows can share tables by referencing the same table name in their `storage:` block. This is intentional — the workflow author manages their own data relationships. The workflow auditor (ADR-008, rule D-001) warns when two workflows declare incompatible schemas for the same table.

### When to use `storage:` vs `state` table

- **`state` table** (ADR-003): simple key-value storage — counters, flags, single values per key. No columns, no queries.
- **`storage:` block**: structured tables with columns, primary keys, indexes. Use when you need queries, multiple fields per row, or relational structure.

### Naming convention

All workflow tables are prefixed with `wf_` to separate them from system tables (`events`, `queue`, `state`, `relays`).

## Rationale

- **Fits the "low-code for non-technical users" requirement.** Workflow authors write YAML, not SQL. The storage declaration uses the same language as the rest of the workflow.
- **Clean separation.** System tables managed by core versioned migrations. Workflow tables managed automatically by the engine from YAML declarations. No cross-contamination.
- **Lifecycle is automatic.** The table is created when the workflow is loaded. No manual migration step. No orphan management needed until explicit cleanup.
- **Additive-only policy eliminates data loss risk.** The engine never guesses intent on destructive changes (rename vs delete+add). It only adds. Cleanup is explicit and manual.
- **SQL is not harder than YAML, but context matters.** SQL `CREATE TABLE` is simple and universal. However, the workflow author already works in YAML. Having to write a separate `.sql` file in a different directory (`db/migrations/`) for the same workflow breaks the single-file mental model and creates lifecycle coupling issues (orphan tables, ordering).

## Type mapping

| YAML type | SQLite type |
|-----------|-------------|
| `string` | TEXT |
| `number` | REAL |
| `integer` | INTEGER |
| `boolean` | INTEGER |
| `datetime` | TEXT |
| `json` | TEXT |

## Discussion trail

**Reviewer input:**
- devA (specs:575): "Remove. It makes no sense to represent the [DB] model in the spec. This is bound to diverge."
- devA (high-level review): "Evolving the schema is problematic, maintainers will have to work their way around the day zero schema."
- devA (specs:848): "Don't prescribe such a restrictive implementation."

**Product context:**
Some workflows need their own structured data beyond simple key-value state. For example, the zap balance tracker maintains per-npub balances that need efficient queries ("all users with balance > 1000", "top zappers this month"). A generic key-value store can't serve these needs without full-table JSON parsing. These workflow-specific tables must be managed separately from system tables to avoid coupling workflow evolution with core schema evolution.

**Christophe (product owner) input:**
"I think we should have system tables on one side and custom/workflow tables on the other side." — Established the requirement for clean separation between system and workflow data.

Raised the schema evolution scenario: "I create a workflow, I put some database information, I update the workflow, the database information changes — what happens?" — Forced the design of the additive-only policy.

"A workflow should carry target format, not creation AND update AND archiving AND deleting AND restoring AND altering." — Established the declarative approach: the workflow describes what it needs, the engine figures out how to get there.

Validated option C + `db clean`: "Yeah, I like this, option C + pipelinostr db clean."

**devC feedback (primary key):**
Flagged that the `storage:` block had no way to declare a primary key — the workflow author couldn't express "one row per npub." Added `primary_key` field with auto-id fallback when not declared. devC also requested upsert semantics (declaring a primary key implies update-or-insert on write) and load-time validation of primary key references.

**Christophe (product owner) on responsibility:**
"This is my responsibility as workflow creator. When I'll do the mistake, I'll do it once." — Established that storage design is the workflow author's job, not the engine's. However, proposed a workflow auditor that catches incoherences (e.g. reading a table as unique when it has no primary key). This led to [ADR-008 — Workflow auditor](008-workflow-auditor.md).

**Turning point:**
Claude initially called option C "too ambitious for v2." Christophe challenged: "How is option C too ambitious?" — forcing a re-evaluation that revealed C requires only ~100-150 lines of code (type mapping + CREATE TABLE generation + ALTER TABLE ADD COLUMN). The "ambitious" label was unjustified caution, not a real technical barrier.

**Claude proposal:**
Initially presented 3 options. Recommended C, then wavered suggesting B might be simpler. Christophe's "target format" insight clarified that C with additive-only was the right and only coherent approach.

**Decision:**
Option C. Workflow declares `storage:` in YAML. Engine auto-creates tables (prefixed `wf_`), only adds columns, never deletes. Explicit cleanup via `pipelinostr db clean`.

## Related ADRs

- [ADR-003 — Database schema](003-database-schema.md): System tables that workflow tables are separated from
- [ADR-008 — Workflow auditor](008-workflow-auditor.md): Validates storage declarations at load time (primary key references, cross-workflow schema coherence)
