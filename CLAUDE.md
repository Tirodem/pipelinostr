# PipeliNostr v2 - Claude Code Context

> **Purpose:** Auto-read by Claude Code to restore context between sessions.
> **Last update:** 2026-04-07
> **Branch:** v2

## Project overview

**PipeliNostr** = "The n8n of Nostr" — Nostr event router to external services.
- Stack: TypeScript / Node.js LTS / SQLite (better-sqlite3 + WAL)
- Repo: `C:\Users\tirod\Documents\pipelinostr`

## Architecture (v2)

15 ADRs in `docs/architecture/` — **read README.md there for the full index.**

Key decisions:
- **ADR-001**: Node.js LTS (not Bun)
- **ADR-002**: better-sqlite3 + WAL (not sql.js)
- **ADR-003**: 4 system tables, JSON columns, versioned migrations
- **ADR-004**: Declarative `storage:` in workflow YAML
- **ADR-005**: Storage port interface (database behind interfaces)
- **ADR-009**: Flat workflow YAML format (no trigger.filters, no actions.config nesting)
- **ADR-010**: Handler registry (one file per handler, auto-discovery)
- **ADR-012**: Multi-source triggers (`source: nostr.dm`, `source: webhook.post`)
- **ADR-013**: Secret management (`env:VAR`, `file:/path`, Secret opaque type)
- **ADR-014**: Ordered shutdown (inbound → queue → handlers → database)

## File structure

```
src/
├── config/          loader.ts, secrets.ts
├── core/            engine.ts, expression.ts, matcher.ts, template.ts,
│                    types.ts, workflow-loader.ts, auditor.ts
├── db/              migrator.ts, migrations/001-initial.sql
├── handlers/        base.ts, registry.ts, 32 handler files
├── inbound/         nostr.ts, webhook.ts
├── queue/           worker.ts
├── storage/         storage.port.ts, sqlite.storage.ts
├── cli/             index.ts
├── utils/           logger.ts, crypto.ts, zap-parser.ts
└── index.ts         ~130 lines: bootstrap + shutdown
```

## Key files to read

| File | Content | When to read |
|------|---------|-------------|
| `docs/architecture/README.md` | All 15 ADR decisions | Before architectural changes |
| `src/core/types.ts` | NormalizedEvent, WorkflowDefinition, all types | Before touching engine |
| `src/handlers/base.ts` | BaseHandler interface + rules | Before writing a handler |
| `src/storage/storage.port.ts` | Storage interfaces | Before touching database |
| `workflows/README.md` | Workflow authoring guide | Before writing workflows |

## Workflow format (v2 flat — ADR-009)

```yaml
id: example
name: Example Workflow
trigger:
  source: nostr.dm                 # origin.type notation (ADR-012)
  from_whitelist: true
  content_pattern: "^/command$"
actions:
  - id: reply                      # flattened — no config: wrapper
    type: nostr_dm
    to: "{{ trigger.sender }}"
    dm_format: "{{ trigger.dm_format }}"
    content: "Response"
```

### Trigger sources (ADR-012)

| Source | Description |
|--------|------------|
| `nostr.dm` | NIP-04 + NIP-17 DMs |
| `nostr.zap` | Zap receipts (kind 9735) |
| `nostr.note` | Text notes (kind 1) |
| `webhook.post` | HTTP webhooks |
| `dm` | Any DM, any platform |

### Template variables

- `trigger.*` — event data (sender, content, source, dm_format, zap.amount)
- `match.*` — regex capture groups from content_pattern
- `actions.{id}.success` — boolean
- `actions.{id}.response.*` — handler response data
- `variables.*` — workflow-level variables
- `parent.variables.*` — parent workflow variables (hooks)

## Handler registry (ADR-010)

Adding a handler = creating one file in `src/handlers/`:
```typescript
export class MyHandler extends BaseHandler {
  static type = 'my_handler'
  static configSchema = z.object({ ... })
  async initialize(config) { ... }
  async execute(action, context) { ... }
  async shutdown() { ... }
}
```

## Secret management (ADR-013)

```yaml
# In handler config YAML
api_key: env:MY_API_KEY       # reads from .env / environment
token: file:/run/secrets/token  # reads from file
```

**Never use `${VAR}` syntax** — deprecated, will be removed.

## Code conventions

- **Handlers**: Extend `BaseHandler`, static type + configSchema
- **Workflows**: ID in kebab-case, YAML in `config/workflows/`
- **Examples**: `workflows/*.yml.example`
- **Logs**: Pino logger (debug/info/warn/error)
- **Tests**: Vitest in `tests/`
- **Build**: `npm run build` before `npm start`
- **Secrets**: NEVER in YAML files — always `env:VAR` or `file:path`

## CLI

```bash
./scripts/pipelinostr.sh workflow list
./scripts/pipelinostr.sh workflow enable <id>
./scripts/pipelinostr.sh workflow audit
./scripts/pipelinostr.sh handler list
./scripts/pipelinostr.sh queue replay <id>
./scripts/pipelinostr.sh db clean
```

IDs: comma-separated, wildcards (*/?), or `all`.

## After push — server commands

```bash
./scripts/rebuild.sh                                    # git pull + npm install + build
./scripts/pipelinostr.sh workflow refresh <ids>          # refresh from examples
./scripts/pipelinostr.sh workflow enable <ids>           # MUST enable after refresh
./scripts/pipelinostr.sh handler refresh <ids>           # refresh handler config
./scripts/pipelinostr.sh handler enable <ids>            # MUST enable after refresh
```

## Rules for Claude

- User speaks English (switched from French for better AI reasoning)
- Prefer concise responses
- **RULE: Present options, wait for confirmation before implementing**
- **RULE: Verify files exist before mentioning them** (use Glob/Grep)
- **RULE: One topic at a time** — only user switches topics
- **RULE: Preview before writing** — show drafts in chat, get approval
- **RULE: Use devC (external agent) for peer review** of ADRs
- **RULE: Don't flip-flop** — give a real recommendation, stand by it
- **RULE: Anonymize reviewers** — devA/devB/devC in public docs
- **COMMIT: Auto commit + push when task is done**
- **DEBUG: Don't remove debug logs until user confirms everything works**
- **NEVER conclude about server state from repo files** — repo has templates, server has live config
