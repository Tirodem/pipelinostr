# ADR-012: Multi-source trigger abstraction

**Status:** Accepted
**Date:** 2026-04-06
**Context:** PipeliNostr is expanding beyond nostr-only inbound. Telegram and Bluesky inbound sources are planned. The current trigger format uses nostr-specific fields (`kinds: [4, 1059]`) that don't translate to other platforms.

## Problem

Triggers are nostr-coupled. Adding a new inbound source (telegram, bluesky, MQTT) would require every piece of engine code that references `event.kind` or `event.pubkey` to learn about the new source. This is the n×m problem devA warned about.

## Decision

**Introduce a `source` field using `origin.type` dot notation (2 levels max). All other filters are flat fields under `trigger:`. No `source_options` block. The engine normalizes all inbound events internally.**

### Trigger format

```yaml
# Nostr DM
trigger:
  source: nostr.dm
  content_pattern: "^/dpo$"
  from_whitelist: true

# Nostr DM, NIP-17 only
trigger:
  source: nostr.dm
  dm_format: nip17
  content_pattern: "^/command"

# Any DM from any platform
trigger:
  source: dm
  content_pattern: "^/help"

# Nostr zap
trigger:
  source: nostr.zap
  min_amount: 1000

# Telegram DM
trigger:
  source: telegram.dm
  content_pattern: "^/start"

# Webhook
trigger:
  source: webhook.post
  path: /api/notify

# Raw nostr event (power user escape hatch)
trigger:
  source: nostr.raw
  kinds: [30023]
```

### Source vocabulary

| Source | Replaces | Description |
|---|---|---|
| `nostr.dm` | `kinds: [4, 1059]` | Nostr DMs (NIP-04 and NIP-17) |
| `nostr.zap` | `kinds: [9735]` | Nostr zap receipts |
| `nostr.note` | `kinds: [1]` | Nostr text notes |
| `nostr.reaction` | `kinds: [7]` | Nostr reactions |
| `nostr.raw` | Any `kinds: [N]` | Raw kind filter (escape hatch) |
| `telegram.dm` | — | Telegram private message (future) |
| `telegram.group` | — | Telegram group message (future) |
| `bluesky.dm` | — | Bluesky direct message (future) |
| `bluesky.mention` | — | Bluesky mention (future) |
| `webhook.post` | `type: http_webhook` | HTTP webhook |
| `dm` | — | Any DM, any platform |
| `zap` | — | Any zap/tip, any platform |

### Dot notation rules

- **Level 1 (origin):** Platform — `nostr`, `telegram`, `bluesky`, `webhook`
- **Level 2 (type):** Event category — `dm`, `zap`, `note`, `mention`, `group`, `raw`
- **No level 3.** Protocol variants (nip04/nip17) and all other criteria are flat filter fields under `trigger:`

### Filter fields

One rule: **`source` = what you listen to. Everything else under `trigger:` = how you filter it.**

All filter fields are flat, at the same level. No `source_options` block. Schema validation per source type — nostr-specific fields are rejected on webhook triggers.

| Field | Scope | Description |
|---|---|---|
| `content_pattern` | All sources | Regex match on message content |
| `from_whitelist` | All sources | Only whitelisted senders |
| `min_amount` | Zap sources | Minimum amount in sats |
| `dm_format` | `nostr.dm` only | `nip04` or `nip17` |
| `relays` | `nostr.*` only | Filter by relay |
| `kinds` | `nostr.raw` only | Raw kind numbers (escape hatch) |
| `path` | `webhook.*` only | HTTP path to match |

### Template variables at execution time

The workflow always has access to event properties via `trigger.*`, regardless of filtering:

| Variable | Description |
|---|---|
| `trigger.sender` | Sender identifier (npub, telegram user id, etc.) |
| `trigger.content` | Message content |
| `trigger.source` | Full source string (e.g. `nostr.dm`) |
| `trigger.origin` | Platform (e.g. `nostr`) |
| `trigger.type` | Event category (e.g. `dm`) |
| `trigger.dm_format` | `nip04` or `nip17` (nostr DMs only) |
| `trigger.zap.amount` | Zap amount in sats (zaps only) |
| `trigger.zap.sender` | Zapper npub (zaps only) |
| `trigger.raw` | Full original event for power users |

`trigger.dm_format` is always available on nostr DMs, even if you didn't filter by it. It tells you how the DM arrived so you can reply in the same format.

## Internal normalization

Each inbound listener converts its events to a `NormalizedEvent`:

```typescript
interface NormalizedEvent {
  source: string;         // "nostr.dm", "telegram.dm"
  origin: string;         // "nostr", "telegram"
  type: string;           // "dm", "zap", "note"
  sender: string;         // canonical ID per platform
  content: string;
  timestamp: number;
  metadata: Record<string, unknown>;  // platform-specific (dm_format, zap amount, etc.)
  raw: unknown;           // original event
}
```

The workflow engine only knows `NormalizedEvent`. Each inbound adapter is responsible for its own mapping. The engine never imports nostr-specific or telegram-specific logic.

The kind-to-source mapping lives inside the nostr listener only:

| Source | Subscribes to kinds |
|---|---|
| `nostr.dm` | [4, 1059] |
| `nostr.zap` | [9735] |
| `nostr.note` | [1] |
| `nostr.reaction` | [7] |
| `nostr.raw` | User-specified `kinds` field |

Users never see kind numbers unless they use `nostr.raw`.

## Migration

| Before (v1) | After (v2) |
|---|---|
| `trigger.type: nostr_event` | Removed (default) |
| `trigger.filters.kinds: [4, 1059]` | `trigger.source: nostr.dm` |
| `trigger.filters.kinds: [9735]` | `trigger.source: nostr.zap` |
| `trigger.filters.kinds: [1]` | `trigger.source: nostr.note` |
| `trigger.filters.from_whitelist: true` | `trigger.from_whitelist: true` |
| `trigger.filters.content_pattern: "..."` | `trigger.content_pattern: "..."` |

Mechanical migration across ~30 workflows.

## Rationale

- **Human-readable.** `source: nostr.dm` is instantly understandable. `kinds: [4, 1059]` is not — nobody should need to know that 1059 is a NIP-17 gift wrap.
- **Multi-source ready.** Adding telegram inbound = writing a new listener that produces `NormalizedEvent`. No engine changes, no workflow format changes.
- **Harmonized filtering.** All filters at the same level under `trigger:`. No `source_options` block, no three-level dots. One place, one mental model.
- **Backward-compatible escape hatch.** `source: nostr.raw` with `kinds: [N]` for power users who need specific event kinds.

## Discussion trail

**Reviewer input:**
- devA (workflow-engine.ts:96): "ProcessedEvent is a nostr-domain object whose transport details leak into workflows. Should have a normalization layer with simple properties (Source, Authenticated, etc.)."
- devA (nostr-listener.ts:16): "Why is this interface exported? The current structure suggests every workflow should care about how the event was produced."

**Product context:**
PipeliNostr already has nostr as inbound and plans telegram and bluesky inbound sources. Workflows should work across sources without the author knowing protocol internals.

**Christophe (product owner) input:**
Proposed the `origin.type` dot notation: "What about `trigger.source: nostr.dm`, or `telegram.dm`, or `discord.mention`?" — the original idea that shaped this ADR.

Raised NIP-04/NIP-17 as a test case for the abstraction. Challenged the `source_options` block as "not harmonized" — pushed for flat fields instead.

"If I only want NIP-17 it's `source: nostr.dm` with `dm_format: nip17`, and if I want all DMs I can evaluate `trigger.dm_format` later." — Validated the dual use (filter vs read).

**devC review:**
Initially proposed `source_options` block + 3-level dots. Reversed after Christophe's harmonization feedback: "The split is technically justified but user-hostile." Updated to: 2 levels max in source, all filters flat under trigger, kill `source_options`.

## Related ADRs

- [ADR-009 — Workflow format](009-workflow-format.md): Flat YAML structure that this builds on
- [ADR-008 — Workflow auditor](008-workflow-auditor.md): Validates source field and per-source filter fields at load time
