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
- **Convention:** Use workflow ID prefix in DM to target specific workflow
  - Example: `[telegram] Hello world` triggers `nostr-to-telegram.yml`
  - Pattern: `content_pattern: "^\\[telegram\\]\\s*(?<message>.+)"`

---

### Meta-Workflows (Workflow Orchestration)

**Priority:** Medium
**Status:** Proposed

#### Description

Implement meta-workflows that can orchestrate multiple workflows as steps, with parallel or sequential execution.

#### Use Case

Complex automation scenarios like:
- Send notification to Slack AND Telegram simultaneously (parallel)
- Create GitHub issue, then post link to Discord (sequential)
- Fan-out: notify multiple channels from a single DM
- Conditional branching based on previous step results

#### Proposed Syntax

```yaml
id: multi-notify
name: Multi-Channel Notification
enabled: true
type: meta  # New workflow type

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^\\[broadcast\\]\\s*(?<message>.+)"

steps:
  # Parallel execution
  - parallel:
      - workflow: slack-forward
        params:
          message: "{{ match.message }}"
      - workflow: telegram-forward
        params:
          message: "{{ match.message }}"
      - workflow: discord-forward
        params:
          message: "{{ match.message }}"

  # Sequential execution
  - sequence:
      - workflow: github-create-issue
        id: issue
        params:
          title: "From Nostr: {{ match.message | truncate:50 }}"
      - workflow: slack-notify
        params:
          message: "Issue created: {{ steps.issue.result.url }}"
        when: "{{ steps.issue.success }}"
```

#### Implementation Notes

- New `type: meta` for orchestration workflows
- `parallel:` block executes all workflows concurrently
- `sequence:` block executes workflows in order
- Access previous step results via `steps.<id>.result`
- Conditional execution with `when:`

---

### Hardware Testing Protocol

**Priority:** High
**Status:** Proposed

#### Description

Define a testing protocol to validate PipeliNostr with hardware handlers.

#### Recommended Test Setup

**Option 1: Raspberry Pi + Arduino (Most Complete)**

| Handler | Hardware | Test Case |
|---------|----------|-----------|
| GPIO | Raspberry Pi 4/5 | Toggle LED via DM: `[gpio] pin:17 state:high` |
| I2C | RPi + BME280 sensor | Read temp/humidity, send to Nostr |
| Serial | Arduino Uno (USB) | Send command, receive response |
| MQTT | Mosquitto on RPi | Pub/sub test with local broker |
| BLE | RPi + BLE device | Scan and send characteristic |

**Option 2: ESP32 Only (Minimal)**

| Handler | Hardware | Test Case |
|---------|----------|-----------|
| Serial | ESP32 via USB | Bidirectional serial communication |
| MQTT | ESP32 + WiFi | Connect to public broker (test.mosquitto.org) |
| BLE | ESP32 built-in | Advertise/scan BLE services |

**Option 3: Software Simulation (No Hardware)**

| Handler | Tool | Test Case |
|---------|------|-----------|
| Serial | `socat` virtual ports | `socat -d -d pty,raw,echo=0 pty,raw,echo=0` |
| MQTT | Mosquitto Docker | `docker run -p 1883:1883 eclipse-mosquitto` |
| GPIO | `gpio-mock` npm package | Simulated GPIO for testing |

#### Test Scenarios

1. **Nostr DM → GPIO LED**
   - Send: `[gpio] on`
   - Expected: LED turns on, confirmation sent back

2. **Nostr DM → Serial → Arduino**
   - Send: `[serial] PING`
   - Expected: Arduino responds `PONG`, forwarded to Zulip

3. **MQTT Sensor → Nostr Note**
   - Publish temp reading to MQTT topic
   - Expected: PipeliNostr publishes Nostr note with reading

4. **Scheduled I2C Read**
   - Cron: every 5 minutes
   - Expected: Read BME280, store in database

#### Recommended Hardware Shopping List

**Budget (~50€):**
- Raspberry Pi Zero 2 W (~20€)
- BME280 sensor module (~5€)
- LED + resistors (~2€)
- Breadboard + wires (~5€)

**Full Setup (~100€):**
- Raspberry Pi 4 2GB (~50€)
- Arduino Nano (~10€)
- BME280 + other I2C sensors (~15€)
- ESP32 DevKit (~10€)
- LED, relay module, breadboard (~15€)

---

### Web Dashboard for Job Monitoring

**Priority:** Medium
**Status:** Proposed

#### Description

Simple web dashboard to visualize workflow executions and job status from the SQLite database. No nginx config required - served directly by PipeliNostr on an existing or new port.

#### Features

- **Job List:** Recent workflow executions with status (success/failed/pending)
- **Stats:** Success rate, execution count per workflow, average duration
- **Filters:** By workflow, status, date range
- **Live Updates:** Auto-refresh or WebSocket for real-time status
- **Event Log:** View incoming events and their processing status

#### Implementation

**Option A: Built-in (Recommended)**
- Serve static HTML/JS from PipeliNostr's existing HTTP server
- API endpoints: `GET /api/dashboard/jobs`, `GET /api/dashboard/stats`
- Single-page app with vanilla JS or Alpine.js (no build step)
- Access via `http://localhost:3000/dashboard`

**Option B: Standalone HTML**
- Generate static HTML report on demand
- Command: `npm run report` → creates `reports/dashboard.html`
- Open directly in browser, no server needed

#### Proposed UI

```
┌─────────────────────────────────────────────────────────┐
│  PipeliNostr Dashboard                    [Auto-refresh]│
├─────────────────────────────────────────────────────────┤
│  ✅ 142 Success  │  ❌ 3 Failed  │  ⏳ 0 Pending       │
├─────────────────────────────────────────────────────────┤
│  Recent Executions                                      │
│  ┌─────────────────────────────────────────────────────┐│
│  │ ✅ zulip-forward      2s ago     12ms              ││
│  │ ✅ email-command      5m ago     245ms             ││
│  │ ❌ telegram-forward   1h ago     err: timeout      ││
│  │ ✅ zulip-forward      1h ago     18ms              ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  Workflows Stats                                        │
│  ┌──────────────────┬───────┬─────────┬───────────────┐│
│  │ Workflow         │ Total │ Success │ Avg Duration  ││
│  ├──────────────────┼───────┼─────────┼───────────────┤│
│  │ zulip-forward    │ 98    │ 97%     │ 15ms          ││
│  │ email-command    │ 45    │ 100%    │ 230ms         ││
│  └──────────────────┴───────┴─────────┴───────────────┘│
└─────────────────────────────────────────────────────────┘
```

#### Security

- Dashboard accessible only on localhost by default
- Optional: basic auth or API key for remote access
- No sensitive data exposed (no message content, just metadata)

#### Configuration

```yaml
# config/config.yml
dashboard:
  enabled: true
  port: 3000        # Auto-increment if port taken (3001, 3002, etc.)
  host: "127.0.0.1" # localhost only by default
  # host: "0.0.0.0" # expose to network (use with auth)
  auth:
    enabled: false
    username: "admin"
    password: ${DASHBOARD_PASSWORD}
```

---

### Nostr Zap Listener

**Priority:** Medium
**Status:** Proposed

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

### Streaming Platform Handlers

**Priority:** Low
**Status:** Proposed

#### Description

Add handlers for live streaming platforms to enable Nostr-to-stream interactions.

#### Platforms to Support

| Platform | Handler Type | Use Cases |
|----------|--------------|-----------|
| **Twitch** | `twitch` | Send chat messages, trigger alerts, manage polls |
| **YouTube Live** | `youtube_live` | Send chat messages, manage live stream settings |
| **Kick** | `kick` | Send chat messages |
| **OBS WebSocket** | `obs` | Control scenes, sources, start/stop streaming |
| **StreamElements** | `streamelements` | Trigger alerts, overlays, tip messages |
| **Streamlabs** | `streamlabs` | Trigger alerts, donations display |

#### Example Use Cases

1. **Nostr DM → Twitch Chat**
   - `[twitch] Hello from Nostr!` → Posts in Twitch chat

2. **Nostr DM → Stream Alert**
   - `[alert] Special message!` → Triggers on-screen alert via StreamElements

3. **Nostr DM → OBS Scene Switch**
   - `[obs] scene:Gaming` → Switches OBS to "Gaming" scene

4. **Scheduled → YouTube Live**
   - Cron job to post scheduled messages in YouTube live chat

5. **External Donation → Stream Alert**
   - Webhook receives donation from BTCPay/LNbits → Triggers StreamElements alert
   - `[alert] 🎉 Thanks {donor} for {amount} sats!`

6. **Nostr Zap → Stream Notification**
   - Listen for zap events → Display on stream via OBS browser source

#### Implementation Notes

- Twitch: Uses IRC or Helix API
- YouTube: Uses YouTube Data API v3 (liveChatMessages)
- OBS: Uses obs-websocket protocol
- StreamElements/Streamlabs: REST APIs with OAuth

#### Configuration Example

```yaml
# config/handlers/twitch.yml
twitch:
  enabled: true
  client_id: ${TWITCH_CLIENT_ID}
  client_secret: ${TWITCH_CLIENT_SECRET}
  access_token: ${TWITCH_ACCESS_TOKEN}
  channel: "your_channel"
  bot_username: "PipeliNostrBot"
```

---
