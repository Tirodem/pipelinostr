# PipeliNostr Backlog

## Features

### Dynamic Relay Discovery from nostr.watch

**Priority:** Low
**Status:** Proposed

#### Description

Add a system to dynamically discover and add relays from external sources, with nostr.watch as the default provider.

#### Use Case

Currently, relays are statically configured in `config/config.yml`. Users need to manually update this list to add new relays. A dynamic discovery system would:

- Automatically fetch available relays from nostr.watch/relays (or similar sources)
- Filter relays based on criteria (uptime, latency, geographic location, etc.)
- Add/remove relays at runtime without restart
- Optionally persist discovered relays

#### Proposed Implementation

1. **Relay Discovery Service** (`src/core/relay-discovery.ts`)
   - Fetch relay list from configurable sources (default: `https://api.nostr.watch/v1/public`)
   - Parse and validate relay URLs
   - Filter based on configurable criteria

2. **Configuration Options** (`config/config.yml`)
   ```yaml
   nostr:
     relays:
       static:
         - wss://relay.damus.io
       discovery:
         enabled: true
         sources:
           - url: "https://api.nostr.watch/v1/public"
             type: nostr_watch
         refresh_interval: 3600 # seconds
         max_relays: 10
         filters:
           min_uptime: 0.95
           max_latency_ms: 500
   ```

3. **API Endpoints**
   - `GET /api/relays` - List all connected relays
   - `POST /api/relays/refresh` - Trigger relay discovery
   - `POST /api/relays` - Manually add a relay

#### References

- nostr.watch API: https://api.nostr.watch/v1/public
- NIP-65 (Relay List Metadata): https://github.com/nostr-protocol/nips/blob/master/65.md

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

---
