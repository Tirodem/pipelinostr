# ADR-002: Database engine

**Status:** Accepted
**Date:** 2026-04-06
**Context:** v2 refactor based on devA/devB code review

## Problem

The current database layer uses `sql.js` (WASM-based, in-memory SQLite). Multiple critical issues were identified in the code review. What database engine should v2 use?

## Options considered

| Option | Pros | Cons |
|--------|------|------|
| **sql.js (current)** | Pure JS, works everywhere | In-memory only, no WAL, no journaling, 100ms debounce = guaranteed data loss window, 2x DB size memory spike on every save, crash = data loss |
| **better-sqlite3** | Native SQLite bindings, WAL mode, synchronous API, crash-safe, zero memory overhead for persistence | Needs C++ compiler for first install (native addon) |
| **MongoDB** | Flexible documents, native JSON | Separate daemon, 200-400MB RAM minimum, overkill for single-process app, contradicts "light & simple" |
| **PostgreSQL** | Full-featured RDBMS | Even heavier, needs separate server, multi-user features not needed |
| **Bun built-in SQLite** | Zero install, native | Tied to Bun runtime (rejected in ADR-001) |

## Decision

**better-sqlite3 with WAL mode**

## Rationale

- **Fixes every data safety issue identified by devB.** WAL mode provides crash-safe writes. No more in-memory DB with debounced flush. No more `db.export()` memory spikes. No more `writeFileSync` corruption risk.
- **Zero setup for end users.** SQLite is embedded — no daemon, no server, no configuration. One file in `data/pipelinostr.db`. Backup = copy the file.
- **Fits the deployment targets.** Orange Pi, Raspberry Pi, Termux, cheap VPS. All single-node, single-process. A database server would be wasted overhead.
- **Synchronous API matches the codebase.** `better-sqlite3` is synchronous, eliminating the race conditions devB identified in the dequeue logic (SELECT then UPDATE without transaction safety).
- **Native compilation is a one-time cost.** `npm install` handles it. Prebuilt binaries available for most platforms.

## Discussion trail

**Reviewer input:**
- devB (database.ts:1): "sql.js is WASM-based in-memory SQLite. Entire DB lives in RAM, flushed via debounced save() every 100ms. No WAL, no journaling — crash = all changes since last save are gone."
- devB (database.ts:65): "writeFileSync direct overwrite. Kill mid-write = corrupted file, all data lost."
- devB (database.ts:64): "db.export() + Buffer.from(data) = two full copies. For 10MB DB: 20MB memory spike every 100ms."
- devB (database.ts:655): "Any future async code between SELECT and UPDATE creates race condition."
- devA (specs:848): "Why prescribe such a restrictive implementation? Spec something like 'structured database resilient to unexpected shutdowns'."

**Product context:**
PipeliNostr runs on single-node, low-resource hardware (Orange Pi, Raspberry Pi, cheap VPS). A database server (MongoDB, PostgreSQL) would add daemon management, RAM overhead (200-400MB+), and installation complexity — contradicting the "light & simple" product goal.

**Christophe (product owner) question:**
"What about MongoDB or something else?" — Challenged the default SQLite assumption to ensure alternatives were properly evaluated.

**Claude proposal:**
better-sqlite3 with WAL mode. Fixes every data safety issue devB identified. Zero setup, embedded, single file. MongoDB evaluated and rejected for resource overhead on target hardware.

**Decision:**
better-sqlite3 + WAL. The spec describes "structured database resilient to unexpected shutdowns" (per devA). The implementation chooses better-sqlite3 for its fit with the deployment targets.

## Post-review: ARM compilation risk (devC feedback)

**devC concern:**
"Native compilation is a one-time cost" undersells the pain. On ARM boards, better-sqlite3 compilation requires python3, make, and g++, can take minutes, and occasionally fails on memory-constrained devices (1GB RPi).

**Verification:**
better-sqlite3 v12.8.0 provides prebuilt binaries for linux-arm64 (glibc and musl) covering Node.js 20 (ABI v115), 22 (ABI v127), and 24 (ABI v131). On Raspberry Pi 4+ and Orange Pi with 64-bit OS, `npm install` downloads the prebuilt binary — no compiler toolchain needed. Compilation fallback only applies to exotic platforms or future Node versions not yet covered.

**Residual risk:**
On 32-bit ARM or very constrained boards without prebuilt coverage, compilation may still fail. This is mitigated by targeting Node.js LTS on 64-bit ARM, which is the recommended setup for both deployment profiles (see ADR-001).

**Christophe (product owner) question:**
"Should it be viable to add a database-less behavior? Not every use requires a database." — A simple GPIO workflow (zap → servo) needs no persistence.

This opened the question of whether the database should be a hard requirement or an optional layer. See [ADR-005 — Storage port interface](005-storage-port.md).

**devC final review:** Accepted. No remaining gaps. Minor implementation notes for code review: set `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout` at connection open. Note that better-sqlite3 bundles its own SQLite version (not the OS-provided one).
