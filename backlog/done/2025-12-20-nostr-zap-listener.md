---
title: "Nostr Zap Listener"
priority: "Medium"
status: "DONE"
created: "2025-12-20"
completed: "2025-12-20"
---

### Nostr Zap Listener

**Priority:** Medium
**Status:** DONE

#### Description

Listen for Nostr zap receipts (kind 9735) to trigger workflows on incoming zaps.

#### Use Cases

- Forward zap notifications to Telegram/Discord/Zulip
- Trigger stream alerts (StreamElements/OBS) on zaps
- Log zaps to database for analytics
- Auto-reply thank you DM to zapper

#### Implementation

1. Add kind 9735 to NostrListener filters
2. Parse zap receipt to extract:
   - `amount` (sats)
   - `sender` (npub of zapper)
   - `message` (zap comment)
   - `recipient` (who received the zap)
   - `event_id` (zapped note/profile)

3. Expose in trigger context:
   ```yaml
   trigger:
     zap:
       amount: 1000
       sender: "npub1..."
       sender_name: "Alice"  # if available from profile
       message: "Great post!"
       recipient: "npub1..."
   ```

#### Example Workflow

```yaml
id: zap-alert
name: Zap Notification
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [9735]
    # Optional: only zaps above threshold
    # zap_min_amount: 100

actions:
  - id: notify_zulip
    type: zulip
    config:
      type: stream
      content: "⚡ Zap de {{ trigger.zap.sender }}: {{ trigger.zap.amount }} sats - {{ trigger.zap.message }}"
```

---


---
