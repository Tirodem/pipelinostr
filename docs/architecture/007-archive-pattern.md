# ADR-007: Local buffer + cloud archive pattern

**Status:** Accepted
**Date:** 2026-04-06
**Context:** Emerged from ADR-003 retention policy discussion — "SQLite has no cloud equivalent, how to handle long-term storage?"

## Problem

SQLite is local and file-based — there's no managed cloud SQLite service. For users who need long-term event history beyond what local storage allows (especially on storage-constrained SBCs), how do we provide cloud durability without changing the database engine?

## Decision

**SQLite remains the local real-time buffer. Cloud archival is handled by the archive-before-purge workflow using existing outbound handlers.** The archive destination is just a regular PipeliNostr outbound action — no new code required.

## How it works

```
SQLite (local, fast)              Cloud destination (user's choice)
┌──────────────┐                  ┌──────────────────┐
│ events       │──[archive]──────►│ archive store    │
│ queue        │  workflow         │ (postgres, mongo,│
│ state        │                   │  S3, file, ...)  │
└──────────────┘                  └──────────────────┘
     ↓ purge (after archive confirmed)
```

1. Retention policy triggers `pre_purge` internal event
2. Archive workflow exports events via `export_events` system action
3. Workflow pushes to cloud via existing handler
4. On success: engine purges local rows
5. On failure: purge aborts, admin notified

## Archive destinations

The archive target is any outbound handler. Multiple cloud-capable handlers already exist:

| Destination | Handler | Cloud options | Notes |
|---|---|---|---|
| PostgreSQL | `postgres` | Supabase, Neon, RDS | SQL queries, joins, analytics on archived data |
| MongoDB | `mongodb` | Atlas free tier | Schema-flexible, stores raw event JSON naturally |
| MySQL | `mysql` | PlanetScale, RDS | SQL queries, widely available |
| Object storage | `http` | S3, R2, MinIO | Best for bulk append-only archival |
| FTP/NAS | `ftp` | Any FTP server | Simple file-based backup |
| Local backup | `file` | — | Simplest, no cloud dependency |
| Email | `email` | Any SMTP | Small archives as attachments |

**Schema-flexible targets** (MongoDB, S3/HTTP) are simpler — dump event JSON as-is, no migration when event shape changes. **Relational targets** (PostgreSQL, MySQL) enable querying and analytics but carry a schema migration burden. The choice depends on the user's setup and needs.

## Example workflow

```yaml
id: archive-to-cloud
name: Archive events before purge
trigger:
  type: internal
  source: pipelinostr.retention.pre_purge
actions:
  - id: export
    type: export_events
    format: json
  - id: push_to_cloud
    type: postgres                              # swap to mongodb, http, ftp, etc.
    connection: "env:ARCHIVE_DB_URI"
    table: pipelinostr_archive
    data: "{{ actions.export.response.records }}"
```

Switching destination = changing the action `type` and connection details. No code change.

## Rationale

- **Zero new code.** Uses existing handlers and the planned retention workflow mechanism. The fact that archival requires no new code validates the handler abstraction.
- **User chooses the destination.** No hardcoded cloud provider. Whatever database or storage the user already pays for.
- **Local-first by design.** SQLite handles real-time processing with zero network dependency. Cloud is optional, for durability only.
- **Alternatives considered and rejected:**
  - Switch to managed PostgreSQL/MongoDB for everything → overkill, adds daemon, contradicts ADR-002
  - Replicate SQLite files to S3 → brittle (WAL files, partial copies), not queryable remotely
  - Just purge and lose the data → unacceptable for paid services (e.g. zap-gated features need transaction history)

## Operational risks

- **Purge-before-ack:** Engine must NOT purge until archive workflow confirms success. If archive fails, purge stops.
- **Backpressure:** If cloud destination is unreachable, local SQLite grows until archive succeeds. Operators should be aware disk usage can spike during network outages.
- **Schema drift:** Archived events may evolve in shape over months. Consumers of the archive should not assume a fixed schema across time.

## Discussion trail

**Product context:**
SQLite has no cloud equivalent. MongoDB has Atlas, PostgreSQL has managed services. This was raised as a potential weakness of the SQLite choice (ADR-002).

**Christophe (product owner) insight:**
"We have a mongo handler. So can we imagine a local SQL to cloud mongo backup? In that case, local SQL base becomes a buffer, and real logs are on distant mongo." — Identified the composition pattern using existing handlers.

Then challenged the MongoDB-centric framing: "We also have a postgres handler. PostgreSQL has cloud services. Is it interesting to provide both options?" — Pushed the ADR to be destination-agnostic.

**devC review:**
"The core architectural decision is 'local SQLite buffer + async archive to a remote target.' The which remote target is a deployment choice, not an architecture choice. If the ADR couples to MongoDB, it's not an ADR — it's a tutorial." Confirmed the pattern is sound and destination-agnostic.

## Related ADRs

- [ADR-002 — Database engine](002-database-engine.md): SQLite choice that motivated this pattern
- [ADR-003 — Database schema](003-database-schema.md): Retention policy and archive-before-purge mechanism
- [ADR-005 — Storage port interface](005-storage-port.md): Correctly scoped — archival is application-level, not storage-port-level
