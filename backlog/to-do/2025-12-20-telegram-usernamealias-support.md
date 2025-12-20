---
title: "Telegram Username/Alias Support"
priority: "Low"
status: "Proposed"
created: "2025-12-20"
---

### Telegram Username/Alias Support

**Priority:** Low
**Status:** Proposed

#### Description

Allow sending Telegram messages by username/alias instead of chat_id.

#### Problem

Telegram Bot API only supports sending messages by `chat_id`, not by username. A bot cannot initiate a conversation - the user must first message the bot.

#### Possible Solutions

1. **Shared Group**
   - Create a Telegram group with bot + users
   - Bot sends to the group (single chat_id)
   - Everyone sees notifications

2. **Telegram Channel**
   - Create a channel with bot as admin
   - Public or private (invite link)
   - Single chat_id for all subscribers

3. **Auto-registration (Recommended)**
   - User sends `/start` to the bot
   - PipeliNostr listens (webhook or polling) and saves username → chat_id mapping
   - Then messages can be sent by username lookup
   - Config example:
     ```yaml
     telegram:
       aliases:
         alice: "123456789"
         bob: "987654321"
     ```

#### Implementation Notes

Option 3 requires adding a Telegram webhook/polling listener to capture incoming messages and register users automatically.

---


---
