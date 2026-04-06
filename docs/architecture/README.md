# PipeliNostr v2 — Architecture Decision Records

> Decisions made during v2 refactor, based on code review from [gntw/pipelinostr#1](https://github.com/gntw/pipelinostr/pull/1) (devA + devB, Feb 2026).
>
> Each ADR documents the problem, options considered, decision, and rationale — linking back to specific reviewer comments.

| ADR | Decision | Key driver |
|-----|----------|------------|
| [001 — Runtime](001-runtime.md) | Node.js | Package compatibility, zero risk on critical deps |
| [002 — Database engine](002-database-engine.md) | better-sqlite3 + WAL | Data safety, light footprint, zero setup |
| [003 — Database schema](003-database-schema.md) | 4 system tables, JSON columns, versioned migrations | Evolvability, separation of concerns |
| [004 — Workflow tables](004-workflow-tables.md) | Declarative `storage:` in YAML + `db clean` CLI | End-user simplicity, automatic lifecycle, clean separation |
| [005 — Storage port interface](005-storage-port.md) | Database mandatory in v2, storage port interface for future lightweight mode | Keep door open for database-less mode without building it now |
| [006 — Queue scope](006-queue-scope.md) | Internal queue = single-process only | Simplicity, no race conditions, clear boundary for future multi-agent |
| [007 — Archive pattern](007-archive-pattern.md) | Local SQLite buffer + cloud archive via existing handlers | Long-term storage without changing DB engine, destination-agnostic |
| [008 — Workflow auditor](008-workflow-auditor.md) | Static lint at startup + future dry-run CLI (draft) | Catch workflow errors before runtime, zero false positives |
| [009 — Workflow format](009-workflow-format.md) | Flatten trigger/action nesting, hard cut | Simpler YAML for DIY users, mechanical migration |
| [010 — Handler registry](010-handler-registry.md) | One file per handler, instance-based registry, auto-discovery | 5 places → 1 file, partial availability on failure |
| [011 — Replay strategy](011-replay-strategy.md) | Re-inject dead events, idempotency flag later | Simple recovery, same code path, no second engine |
| [012 — Multi-source triggers](012-multi-source-triggers.md) | `source: origin.type` dot notation, flat filters, NormalizedEvent | Multi-platform ready, human-readable, harmonized |
| [013 — Secret management](013-secret-management.md) | `env:` + `file:` resolvers, redaction wrapper, uniform security model | One security model for all deployments, automatic by default |
| [014 — Process lifecycle](014-process-lifecycle.md) | Ordered shutdown, timeout contracts, handler author rules | No stuck handlers, no re-entrance, clear lifecycle contract |
| [015 — Dependency management](015-dependency-management.md) | Handler manifests, check-and-prompt, install profiles | Only install what you use, clear messages, no auto-magic |
