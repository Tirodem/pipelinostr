# ADR-009: Workflow YAML format (v2)

**Status:** Accepted
**Date:** 2026-04-06
**Context:** v2 rewrite — parser is new code, opportunity to simplify the workflow authoring experience

## Problem

The current workflow YAML format has two levels of nesting that add indentation and cognitive load without carrying information:
- `trigger.type` is always `nostr_event` (boilerplate)
- `trigger.filters.*` wraps all filter fields unnecessarily
- `actions.*.config.*` separates action metadata from action parameters for no practical benefit

## Decision

**Flatten the format. Hard cut, no dual-format support (zero external users).**

### Before (v1)

```yaml
trigger:
  type: nostr_event
  filters:
    kinds: [4, 1059]
    from_whitelist: true
    content_pattern: "^/dpo$"

actions:
  - id: send
    type: telegram
    config:
      text: "{{ trigger.zap.amount }} sats"
      parse_mode: HTML
```

### After (v2)

```yaml
trigger:
  kinds: [4, 1059]
  from_whitelist: true
  content_pattern: "^/dpo$"

actions:
  - id: send
    type: telegram
    text: "{{ trigger.zap.amount }} sats"
    parse_mode: HTML
```

### What changes

| Element | v1 | v2 |
|---|---|---|
| `trigger.type` | Required | Optional, defaults to `nostr_event` |
| `trigger.filters.*` | Nested under `filters` | Flattened to `trigger.*` |
| `actions.*.config.*` | Nested under `config` | Flattened into the action |
| `hooks` | As-is | No change |
| `variables` | As-is | No change |
| Template variables | `trigger.*`, `match.*`, `actions.*`, `variables.*`, `parent.*` | No change |
| `enabled` | Required | Defaults to `true` when omitted |

### Migration

Mechanical — a script or manual pass converts all 50+ workflow examples. No semantic change, only structural flattening. Migrated files are validated by the workflow auditor (ADR-008).

No dual-format support. The v2 parser only accepts the flat format. The v1 nested format (`trigger.filters.*`, `actions.*.config.*`) is not carried over — it was a structural artifact with no semantic value. The only current user (product owner) migrates alongside the v2 switch.

## Rationale

- **Less YAML errors.** Fewer indentation levels = fewer syntax mistakes, the #1 pain point for low-technical DIY users.
- **Easier to read and edit.** Actions read like a form: "type telegram, text X, parse_mode Y" — no mental separation between metadata and parameters.
- **Parser is new code anyway.** v2 rewrites the engine. Supporting the old nesting would add complexity for zero benefit.
- **Zero migration risk.** No external users. Product owner (Christophe) confirmed willingness to follow the changes.
- **`trigger.type` field collision risk is low.** Current trigger fields (`kinds`, `from_whitelist`, `content_pattern`, `zap_min_amount`) are filter-specific. Future trigger types (webhook, scheduler) would use `type: webhook` with their own distinct fields. No overlap expected.

## Discussion trail

**Reviewer input:**
- devA (workflow-engine.ts:96): Raised event normalization — applies to internal code, not YAML surface.
- devA and devB did not comment on the YAML format itself.

**devC review:**
"The nesting is unjustified. Flatten `trigger.filters` and `actions.config`. Make `trigger.type` optional with default. Migration cost is mechanical — a script does 50+ files in minutes. The ongoing cost of keeping unnecessary nesting for every future user is higher than a one-time migration."

Also flagged:
- `when` expressions should be well-documented
- `on_fail` at action level vs `hooks.on_fail` at workflow level — same name, different scope. Consider renaming action-level to `fallback` to avoid confusion.
- `enabled` should default to `true` when omitted

**Christophe (product owner) input:**
"There's no user right now except me, I can follow the changes, as long as we keep on the burner a tool that'll rewrite all the workflows to new target. Considering the number, it's highly doable."

**Decision:**
Option B. Flatten, hard cut, mechanical migration.
