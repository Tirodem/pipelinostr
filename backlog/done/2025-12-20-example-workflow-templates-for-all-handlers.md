---
title: "Example Workflow Templates for All Handlers"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### Example Workflow Templates for All Handlers

**Priority:** Medium
**Status:** Proposed

#### Description

Create example workflow templates for each handler in `examples/workflows/`.

#### Templates to Create

**Social/Messaging (forward DM style):**
- Telegram: `nostr-to-telegram.yml`
- Slack: `nostr-to-slack.yml`
- Discord: `nostr-to-discord.yml`
- WhatsApp: `nostr-to-whatsapp.yml`
- Signal: `nostr-to-signal.yml`
- Matrix: `nostr-to-matrix.yml`
- Mastodon: `nostr-to-mastodon.yml`
- Twitter/X: `nostr-to-twitter.yml`
- Bluesky: `nostr-to-bluesky.yml`
- Lemmy: `nostr-to-lemmy.yml`

**Storage/Data:**
- HTTP/Webhook: `nostr-to-webhook.yml`
- FTP: `nostr-to-ftp.yml`
- SFTP: `nostr-to-sftp.yml`
- MongoDB: `nostr-to-mongodb.yml`
- MySQL: `nostr-to-mysql.yml`
- PostgreSQL: `nostr-to-postgresql.yml`
- Redis: `nostr-to-redis.yml`
- S3: `nostr-to-s3.yml`

**DevOps:**
- GitHub: `nostr-to-github.yml` (create issue from DM)
- GitLab: `nostr-to-gitlab.yml` (create issue from DM)

**Hardware/IoT:**
- MQTT: `nostr-to-mqtt.yml`
- Serial: `nostr-to-serial.yml`
- GPIO: `nostr-to-gpio.yml`

#### Notes

- All templates should use `trigger.type: nostr_event` with `kinds: [4]` and `from_whitelist: true`
- Include comments explaining prerequisites and configuration
- Document available template variables
- **Convention:** Use workflow ID prefix in DM to target specific workflow
  - Example: `[telegram] Hello world` triggers `nostr-to-telegram.yml`
  - Pattern: `content_pattern: "^\\[telegram\\]\\s*(?<message>.+)"`

---


---
