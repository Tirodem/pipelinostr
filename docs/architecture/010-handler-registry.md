# ADR-010: Handler registry pattern

**Status:** Accepted
**Date:** 2026-04-06
**Context:** v2 refactor — devB identified `src/index.ts` as 2185 lines with ~70% copy-paste boilerplate

## Problem

Adding a handler in v1 requires changes in 5 places: handler file, config interface in index.ts, AppState field, initializeHandlers() block, shutdown() block. This is repeated 45 times, producing a 2185-line monolith.

## Decision

**One file per handler. Instance-based registry (not singleton) auto-discovers handlers by scanning the directory.**

### Handler structure

```typescript
// src/handlers/telegram.ts
export class TelegramHandler extends BaseHandler {
  static type = 'telegram'
  static configSchema = z.object({
    bot_token: z.string(),
    default_chat_id: z.string().optional()
  })

  async initialize() { /* connect to Telegram API */ }
  async execute(action, context) { /* send message */ }
  async shutdown() { /* cleanup */ }
}
```

Adding a handler = creating one file. No other changes needed.

### Registry design

```typescript
// src/handlers/registry.ts — exports a CLASS, not an instance
export class HandlerRegistry {
  private handlers: Map<string, BaseHandler>

  async loadAll(configDir: string) { /* scan, validate, instantiate */ }
  get(type: string): BaseHandler | undefined { /* lookup */ }
  async shutdownAll() { /* iterate and shutdown */ }
}
```

The registry is owned by AppState, not a global singleton. Handlers never know the registry exists — they implement the interface.

## Startup behavior

### Config validation

All handler configs are validated with Zod at startup, before any handler initializes. Clear error messages: "telegram handler: bot_token is empty."

### Failure handling

| Situation | Behavior |
|---|---|
| Handler config invalid | WARNING log, handler marked `unavailable`, app starts |
| Handler initialize() throws | WARNING log, handler marked `unavailable`, app starts |
| All handlers fail | App still starts — inbound listener and queue still work, events queue up |
| Nostr is available at startup | DM admin npub: "PipeliNostr started with degraded handlers: email (SMTP unreachable)" |
| Workflow uses unavailable handler | Workflow action fails with clear error, `on_fail` triggers normally |

**Principle: silent at startup (WARNING + admin DM), loud at execution (workflow fails properly).** Partial availability beats total failure for a self-hosted DIY tool.

### Auto-discovery

The registry scans `src/handlers/*.ts`, imports each file, checks it extends `BaseHandler`, registers by `static type`. If a file fails to import (syntax error, missing dependency), it is logged and skipped — not an app crash.

## Constraints

- **Handlers must be independent.** No handler depends on another handler being ready. If two handlers share a connection (e.g., nostr DM and nostr note both need relay access), extract it as a shared service injected into both.
- **No dynamic reload in v2.** Handlers are loaded once at startup. Hot-reload can be added later since handlers already have lifecycle methods (initialize/shutdown).
- **No global singleton.** The registry is a class instance, not a module-level object. This allows testing, prevents hidden coupling, and addresses devA's concern.

## Rationale

- **5 places → 1 file.** The single highest-leverage refactor in the codebase.
- **2185 lines → ~100 lines.** index.ts becomes pure wiring: create registry, load handlers, start listeners.
- **Zod config validation catches mistakes at startup**, not hours later when an event triggers the handler.
- **Partial availability** — one broken handler doesn't take down 19 working ones.

## Discussion trail

**Reviewer input:**
- devB (index.ts:1): "1226 lines of identical repetition. 38 handlers × same 5-step pattern. After refactor with registry: ~80 lines."
- devA (reply to devB): "Yes to registry pattern. But avoid singletons or global registries since they can't be dynamically unloaded. Use a simple construction pattern."

**Product context:**
PipeliNostr has 45 handlers. The v1 pattern of adding 5 code blocks per handler doesn't scale and is error-prone. A DIY user extending PipeliNostr with a custom handler should only need to create one file.

**Christophe (product owner) input:**
"If I need 3 handlers on my workflow and 1 fails, it shouldn't be silent. But if it's a more global thing (like email handler is down and my active workflows don't use email), it should not impact the other handlers." — Established the dual behavior: silent at startup (degraded), loud at execution (workflow fails).

Also raised: "We need a huge warning in logs, maybe a Nostr DM to the admin npub" — startup degradation should be visible, not truly silent.

**devC review:**
Confirmed the approach. Key additions: registry must be a class not a singleton (addresses devA), auto-discover by directory scanning, never crash on single handler failure. "Partial availability beats total failure for a self-hosted tool."

## Related ADRs

- [ADR-008 — Workflow auditor](008-workflow-auditor.md): Validates that action types reference loaded handlers (rule S-003)
- [ADR-011 — Replay strategy](011-replay-strategy.md): Failed handler at execution time → event stays in queue for replay
