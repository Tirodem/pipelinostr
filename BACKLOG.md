# PipeliNostr Backlog

## Features

### Dynamic Relay Discovery from nostr.watch

**Priority:** Low
**Status:** DONE

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

### VPN Tunnel for Local Hardware Access

**Priority:** Low
**Status:** Proposed

#### Description

Enable VPS-hosted PipeliNostr to communicate with local network devices (smartphones, IoT, Raspberry Pi) via VPN tunnel.

#### Use Case

When PipeliNostr runs on a VPS but needs to reach local services:
- Traccar SMS Gateway on smartphone (local mode)
- Home automation devices (MQTT broker, GPIO)
- Local databases or APIs

#### Solutions to Explore

| Solution | Complexity | Notes |
|----------|------------|-------|
| **Tailscale** | Low | Zero-config mesh VPN, free tier available |
| **WireGuard** | Medium | Lightweight, high performance, manual setup |
| **Cloudflare Tunnel** | Low | Expose local services via Cloudflare, no open ports |
| **ngrok** | Low | Quick tunnels, free tier limited |
| **ZeroTier** | Low | Similar to Tailscale, P2P mesh network |

#### Recommended: Tailscale

1. Install Tailscale on VPS and smartphone/local device
2. Both devices get a `100.x.x.x` Tailscale IP
3. Configure handler to use Tailscale IP instead of public URL

```yaml
# config/handlers/traccar-sms.yml (local mode via Tailscale)
traccar_sms:
  enabled: true
  gateway_url: "http://100.64.0.2:8082/"  # Tailscale IP of phone
  token: ${TRACCAR_SMS_TOKEN}
```

#### Documentation to Add

- Setup guide for Tailscale with PipeliNostr
- Configuration examples for local handlers
- Troubleshooting connectivity issues

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

### Calendar Invite via Email (iCal)

**Priority:** Medium
**Status:** DONE

#### Description

Send calendar invitations (iCal/ICS format) via email from a Nostr DM command.

#### Use Cases

- Schedule meetings via Nostr DM
- Send event reminders to attendees
- Create recurring events

#### Implementation

This feature uses the existing email handler with an ICS attachment generated from DM parameters.

---

### Event Queue / Message Broker

**Priority:** High
**Status:** DONE

#### Description

Add a message queue layer to handle events reliably with persistence, retry, and replay capabilities.

#### Use Cases

1. **Queue during high traffic:** Buffer events when handlers are busy
2. **Replay failed events:** Re-execute workflows that failed due to handler unavailability
3. **Process missed events:** Handle events that weren't processed (system restart, etc.)
4. **Full audit trail:** Track every trigger from receipt to completion

#### Current State

The `event_log` table tracks events but doesn't support:
- Queuing (pending → processing → done)
- Automatic retry with backoff
- Manual replay of failed events

#### Proposed Implementation (SQLite-based)

1. **New `event_queue` table:**
   ```sql
   CREATE TABLE event_queue (
     id INTEGER PRIMARY KEY,
     event_type TEXT NOT NULL,          -- nostr_dm, api_webhook, hook
     event_data TEXT NOT NULL,          -- JSON payload
     status TEXT DEFAULT 'pending',     -- pending, processing, completed, failed, dead
     priority INTEGER DEFAULT 0,
     retry_count INTEGER DEFAULT 0,
     max_retries INTEGER DEFAULT 3,
     next_retry_at DATETIME,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     started_at DATETIME,
     completed_at DATETIME,
     error_message TEXT,
     workflow_id TEXT,
     result_data TEXT
   );
   ```

2. **Queue Worker:**
   - Polls queue for pending events
   - Marks as `processing` before execution
   - Updates to `completed` or `failed` after
   - Exponential backoff for retries
   - Dead-letter after max retries

3. **API Endpoints:**
   - `GET /api/queue` - List queued events
   - `POST /api/queue/:id/replay` - Replay a failed event
   - `POST /api/queue/replay-failed` - Replay all failed events
   - `DELETE /api/queue/:id` - Remove from queue

4. **CLI Commands:**
   ```bash
   pipelinostr queue list
   pipelinostr queue replay <id>
   pipelinostr queue replay-failed
   pipelinostr queue stats
   ```

#### Future: RabbitMQ/Redis Migration

Design with abstraction layer to allow future migration:
```typescript
interface MessageBroker {
  enqueue(event: QueuedEvent): Promise<string>;
  dequeue(): Promise<QueuedEvent | null>;
  ack(id: string): Promise<void>;
  nack(id: string, requeue: boolean): Promise<void>;
}
```

---

### Hardware Controllable by PipeliNostr

**Priority:** Medium
**Status:** Proposed

#### Description

Identify hardware devices that can be controlled via PipeliNostr workflows.

#### Categories

**1. GPIO / Digital I/O**
| Device | Connection | Handler | Use Case |
|--------|------------|---------|----------|
| LED | Raspberry Pi GPIO | `gpio` | Visual notifications |
| Relay module | RPi/Arduino GPIO | `gpio` | Switch appliances on/off |
| Servo motor | RPi/Arduino PWM | `gpio` | Physical movement |
| Buzzer | GPIO | `gpio` | Audio alerts |

**2. Serial / USB Devices**
| Device | Connection | Handler | Use Case |
|--------|------------|---------|----------|
| Arduino | USB Serial | `serial` | Custom microcontroller commands |
| ESP32/ESP8266 | USB Serial | `serial` | WiFi-enabled MCU |
| 3D Printer | USB Serial | `serial` | Send GCode commands |
| USB Relay | USB Serial | `serial` | Industrial relay control |

**3. Network / IoT**
| Device | Protocol | Handler | Use Case |
|--------|----------|---------|----------|
| Smart bulbs (Philips Hue, LIFX) | HTTP API | `http` | Lighting control |
| Smart plugs (TP-Link, Tasmota) | HTTP/MQTT | `http`/`mqtt` | Power control |
| Shelly devices | HTTP/MQTT | `http`/`mqtt` | Home automation |
| Home Assistant | REST API | `http` | Hub for all devices |
| Node-RED | HTTP | `http` | Flow automation |

**4. MQTT Devices**
| Device | Topic Structure | Handler | Use Case |
|--------|-----------------|---------|----------|
| Zigbee2MQTT bridge | `zigbee2mqtt/+/set` | `mqtt` | Zigbee device control |
| Tasmota devices | `cmnd/+/POWER` | `mqtt` | Sonoff/ESP devices |
| ESPHome devices | `esphome/+/command` | `mqtt` | Custom ESP firmware |

**5. Display / Output**
| Device | Connection | Handler | Use Case |
|--------|------------|---------|----------|
| E-ink display | SPI/I2C | `spi`/`i2c` | Low-power status display |
| LCD/OLED | I2C | `i2c` | Real-time info display |
| LED Matrix | SPI | `spi` | Scrolling text |
| Thermal printer | Serial/USB | `serial` | Print notifications |

**6. Audio**
| Device | Method | Handler | Use Case |
|--------|--------|---------|----------|
| Speaker (local) | `aplay`/`mpg123` | `exec` | Text-to-speech, alerts |
| Sonos | HTTP API | `http` | Multi-room audio |
| Chromecast | Cast protocol | TBD | Cast audio/video |

#### Implementation Priority

1. **Phase 1:** HTTP-based (smart plugs, Home Assistant, APIs)
2. **Phase 2:** MQTT (IoT ecosystem)
3. **Phase 3:** Serial (Arduino, ESP32)
4. **Phase 4:** GPIO (Raspberry Pi native)

---

### Minimal Hardware for Self-Hosted PipeliNostr

**Priority:** Medium
**Status:** DONE

#### Description

Identify economical hardware configurations to run PipeliNostr locally (not on VPS).

#### Requirements

- Node.js 20+ support
- 512MB+ RAM (1GB recommended)
- Network connectivity (Ethernet or WiFi)
- Low power consumption for 24/7 operation
- Optional: GPIO for direct hardware control

#### Hardware Options

**Budget Tier (~20-40€)**

| Device | RAM | Storage | Power | Notes |
|--------|-----|---------|-------|-------|
| **Raspberry Pi Zero 2 W** | 512MB | microSD | 1W | WiFi, compact, limited RAM |
| **Orange Pi Zero 3** | 1GB | microSD | 2W | Good value, H618 SoC |
| **Libre Computer Le Potato** | 2GB | microSD | 3W | RPi alternative |

**Recommended Tier (~50-80€)**

| Device | RAM | Storage | Power | Notes |
|--------|-----|---------|-------|-------|
| **Raspberry Pi 4 Model B 2GB** | 2GB | microSD/SSD | 3-6W | Best ecosystem, GPIO |
| **Raspberry Pi 5 2GB** | 2GB | microSD/NVMe | 4-8W | Faster, PCIe support |
| **Orange Pi 5** | 4GB | eMMC/NVMe | 5W | RK3588S, great perf |
| **Odroid N2+** | 4GB | eMMC | 5W | Reliable, good cooling |

**Mini PC Tier (~100-150€)**

| Device | RAM | Storage | Power | Notes |
|--------|-----|---------|-------|-------|
| **Intel N100 Mini PC** | 8GB | 256GB SSD | 10-15W | x86, runs anything |
| **Beelink Mini S12** | 8GB | 256GB | 15W | Compact, silent |
| **Used Thin Client (HP T620/T630)** | 4-8GB | SSD | 10W | Very cheap used (~30€) |

**Repurposed Hardware**

| Device | Notes |
|--------|-------|
| Old Android phone | Termux + Node.js, free, has battery backup |
| Old laptop | Already have it, overkill but works |
| NAS (Synology/QNAP) | Docker support, always on |

#### Recommended Setup

**Best Value:** Raspberry Pi 4 2GB (~50€) + 32GB microSD (~10€)
- Proven ecosystem
- GPIO for hardware control
- Large community support
- Runs PipeliNostr comfortably

**Most Economical:** Raspberry Pi Zero 2 W (~20€) + 16GB microSD (~5€)
- Tight on RAM but functional
- WiFi built-in
- Ultra-low power (~1W)

**Best Performance:** Intel N100 Mini PC (~100€)
- x86 compatibility
- 8GB RAM, SSD storage
- Can run other services alongside

#### Power Consumption Comparison

| Device | Idle | Load | Monthly Cost (0.20€/kWh) |
|--------|------|------|--------------------------|
| RPi Zero 2 W | 0.5W | 1.5W | ~0.20€ |
| RPi 4 2GB | 2.5W | 6W | ~1.00€ |
| RPi 5 2GB | 3W | 8W | ~1.30€ |
| N100 Mini PC | 6W | 15W | ~2.50€ |

---

### API Webhook Enhancements

**Priority:** Medium
**Status:** Proposed

#### Description

Enhance the webhook server with workflow-bound routes and authentication.

#### Features

**1. Workflow-Bound Routes**

Define routes directly in workflows instead of central webhook config:

```yaml
# Workflow defines its own API route
id: store-to-ftp
name: API to FTP Storage
enabled: true

trigger:
  type: http_webhook
  config:
    path: "/api/store"
    methods: ["POST"]
    # Route only exists when workflow is enabled

actions:
  - id: write_ftp
    type: ftp
    config:
      path: "/data/{{ trigger.timestamp }}.json"
      content: "{{ trigger.content }}"
```

Benefits:
- Routes auto-created when workflow enabled
- Routes auto-removed when workflow disabled
- Self-documenting API (workflow = route)
- Unknown routes return `200 Not Found` (or 404)

**2. API Authentication**

Protect API endpoints with credentials:

```yaml
# config/handlers/webhook.yml
webhook:
  enabled: true
  port: 3000

  auth:
    enabled: true
    methods:
      - type: api_key
        header: "X-API-Key"
        keys:
          - ${API_KEY_1}
          - ${API_KEY_2}
      - type: bearer
        secret: ${JWT_SECRET}

  webhooks:
    - id: "notify"
      path: "/api/notify"
      auth: true  # Requires auth
    - id: "public"
      path: "/api/public"
      auth: false  # No auth required
```

**3. Route Discovery Endpoint**

```
GET /api/routes
```

Returns list of available routes with their associated workflows.

#### Implementation Notes

- Current webhook server already supports `secret` per webhook
- Need to add global auth middleware
- Workflow-bound routes require workflow loader to register routes dynamically

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

### LLM Agent for Natural Language Processing

**Priority:** Very Low (Future Vision)
**Status:** Proposed

#### Description

Connecter PipeliNostr à un agent LLM pour interpréter le langage naturel et le convertir en commandes compatibles avec les workflows, sans se limiter aux regex.

#### Use Case

Au lieu de :
```
[gpio] on pin:17
[telegram] Salut tout le monde
/email to:alice@example.com subject:Test body:Hello
```

L'utilisateur pourrait écrire :
```
Allume la lumière du salon
Envoie un message sur Telegram pour dire bonjour à tout le monde
Envoie un email à Alice pour lui dire bonjour
```

Le LLM analyserait l'intention et mapperait vers le workflow approprié avec les bons paramètres.

#### Architecture Proposée

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Nostr DM       │     │   LLM Agent     │     │  Workflow       │
│  (langage       │────►│  (intent +      │────►│  Engine         │
│   naturel)      │     │   extraction)   │     │  (exécution)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

#### Fonctionnalités Envisagées

1. **Intent Detection** : Identifier le workflow cible
   - "allume la lumière" → `nostr-to-gpio`
   - "envoie sur Telegram" → `nostr-to-telegram`

2. **Entity Extraction** : Extraire les paramètres
   - "lumière du salon" → `pin: 17` (mapping configuré)
   - "à Alice" → `to: alice@example.com`

3. **Confirmation optionnelle** : Demander validation avant exécution
   - "Je vais allumer GPIO 17. Confirmer ?"

4. **Apprentissage contextuel** : Mémoriser les préférences
   - "la lumière" = toujours GPIO 17 pour cet utilisateur

#### Options d'Implémentation

| Option | Avantages | Inconvénients |
|--------|-----------|---------------|
| **OpenAI API** | Puissant, facile | Coût, dépendance externe, privacy |
| **Claude API** | Très capable | Coût, dépendance externe |
| **Ollama (local)** | Gratuit, privé | Ressources, qualité variable |
| **LLaMA.cpp** | Local, léger | Setup complexe |
| **LLM Embarqué** | Zero dépendance, offline | Taille binaire, RAM requise |

#### Option LLM Auto-Embarqué (Vision Long Terme)

Intégrer un petit modèle directement dans PipeliNostr, sans service externe :

```
┌─────────────────────────────────────────────┐
│              PipeliNostr                     │
│  ┌─────────────────────────────────────┐    │
│  │  LLM Embarqué (TinyLlama, Phi-2)    │    │
│  │  - Intent detection                  │    │
│  │  - Entity extraction                 │    │
│  │  - ~2GB RAM, ~1GB disk              │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**Technologies candidates :**
- **node-llama-cpp** : Bindings Node.js pour llama.cpp
- **transformers.js** : Hugging Face en JS (WebGPU/WASM)
- **ONNX Runtime** : Modèles optimisés cross-platform

**Modèles légers adaptés :**
| Modèle | Taille | RAM | Cas d'usage |
|--------|--------|-----|-------------|
| TinyLlama 1.1B | 600MB | 1.5GB | Intent basique |
| Phi-2 2.7B | 1.5GB | 3GB | Meilleure compréhension |
| Mistral 7B Q4 | 4GB | 6GB | Qualité optimale |

**Avantages :**
- Fonctionne offline (RPi, bateau, bunker...)
- Pas de coût API
- Privacy totale
- Latence prévisible

**Inconvénients :**
- Taille binaire augmentée
- RAM requise (min 2GB pour petit modèle)
- Qualité inférieure aux gros modèles cloud
- Temps de chargement au démarrage

#### Cas d'Usage LLM Embarqué

**1. Routage en langage naturel** (runtime)
```
DM: "Allume la lumière du salon"
 → LLM détecte intent: gpio, params: {pin: 17, state: high}
 → Exécute workflow nostr-to-gpio
```

**2. Assistant rédaction de workflows** (dev time)
```
User: "Je veux recevoir un SMS quand quelqu'un me zap plus de 1000 sats"

LLM génère:
┌─────────────────────────────────────────────┐
│ id: zap-sms-alert                           │
│ name: Zap SMS Alert                         │
│ trigger:                                    │
│   type: nostr_event                         │
│   filters:                                  │
│     kinds: [9735]                           │
│     zap_min_amount: 1000                    │
│ actions:                                    │
│   - id: send_sms                            │
│     type: traccar_sms                       │
│     config:                                 │
│       to: "+33612345678"                    │
│       message: "Zap reçu: {{ trigger... }}" │
└─────────────────────────────────────────────┘
```

**3. Validation et suggestions** (dev time)
```
User: workflow avec erreur de syntaxe ou config manquante

LLM: "Il manque le champ 'to' dans l'action email.
      Voulez-vous utiliser l'email par défaut de config/handlers/email.yml ?"
```

**4. Documentation interactive** (runtime)
```
DM: "Comment envoyer un fichier sur FTP ?"

LLM: "Utilisez le handler 'ftp' avec cette syntaxe:
      [ftp] path:/data/file.txt content:Mon contenu
      Ou créez un workflow avec trigger sur content_pattern..."
```

#### Configuration Envisagée

```yaml
# config/config.yml
llm:
  enabled: true
  provider: "ollama"  # ou "openai", "anthropic"
  model: "mistral:7b"
  endpoint: "http://localhost:11434"

  # Mapping intentions → workflows
  intents:
    - patterns: ["lumière", "lampe", "éclairage", "led"]
      workflow: "nostr-to-gpio"
      defaults:
        pin: 17
    - patterns: ["telegram", "tg", "message telegram"]
      workflow: "nostr-to-telegram"
    - patterns: ["email", "mail", "courriel"]
      workflow: "nostr-to-email"

  # Mode de fonctionnement
  mode: "auto"  # auto, confirm, suggest
  fallback: "regex"  # Si LLM échoue, utiliser regex classique
```

#### Workflow Exemple avec LLM

```yaml
id: llm-router
name: LLM Natural Language Router
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    # Pas de content_pattern - le LLM analyse tout

actions:
  - id: analyze
    type: llm_analyze
    config:
      prompt: |
        Analyse ce message et identifie:
        1. L'action souhaitée (workflow)
        2. Les paramètres nécessaires
        Message: {{ trigger.content }}

  - id: route
    type: workflow_call
    config:
      workflow_id: "{{ actions.analyze.response.workflow }}"
      params: "{{ actions.analyze.response.params }}"
```

#### Prérequis

- Handler `llm` à créer
- Action `llm_analyze` pour extraction d'intentions
- Action `workflow_call` pour appel dynamique de workflows
- Système de mapping intent → workflow

#### Considérations

- **Latence** : Appel LLM ajoute 0.5-2s de délai
- **Coût** : APIs payantes (OpenAI ~$0.002/requête)
- **Privacy** : Préférer solutions locales (Ollama) pour données sensibles
- **Fiabilité** : LLM peut mal interpréter → mode confirmation recommandé
- **Fallback** : Toujours garder les regex comme backup

#### Roadmap Suggérée

1. **Phase 1** : Handler LLM basique (appel API, réponse texte)
2. **Phase 2** : Intent detection simple (mapping keywords)
3. **Phase 3** : Entity extraction avec prompts structurés
4. **Phase 4** : Mode conversation (clarification si ambigu)
5. **Phase 5** : Fine-tuning ou RAG avec historique utilisateur

---

### Voice Handlers (STT/TTS)

**Priority:** Very Low (Future Vision)
**Status:** Proposed

#### Description

Ajouter des handlers pour la synthèse et reconnaissance vocale, permettant des interactions audio avec PipeliNostr.

#### Handlers Proposés

**1. Speech-to-Text (STT)** - Reconnaissance vocale
```yaml
type: speech_to_text
config:
  audio_source: "{{ trigger.audio_url }}"  # URL fichier audio
  language: "fr-FR"
  provider: "whisper"  # ou google, azure, embedded
```

**2. Text-to-Speech (TTS)** - Synthèse vocale
```yaml
type: text_to_speech
config:
  text: "{{ trigger.content }}"
  voice: "fr-FR-Standard-A"
  output: "file"  # ou "stream", "nostr_upload"
  provider: "piper"  # ou google, azure, elevenlabs
```

**3. Voice Input** - Écoute micro en continu
```yaml
# Inbound handler (comme webhook)
voice_input:
  enabled: true
  device: "default"  # ou "hw:1,0"
  wake_word: "hey pipelinostr"
  language: "fr-FR"
```

#### Use Cases

**1. Commande vocale → Action**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Micro RPi   │────►│ STT (Whisper)│────►│ LLM Intent  │
│ "Allume     │     │ → texte     │     │ → workflow  │
│  la lumière"│     └─────────────┘     └──────┬──────┘
└─────────────┘                                │
                                               ▼
                                        ┌─────────────┐
                                        │ GPIO ON     │
                                        └─────────────┘
```

**2. Notification vocale**
```yaml
id: zap-voice-notification
trigger:
  type: nostr_event
  filters:
    kinds: [9735]
    zap_min_amount: 500

actions:
  - id: speak
    type: text_to_speech
    config:
      text: "Vous avez reçu un zap de {{ trigger.zap.amount }} sats"
      output: "speaker"
```

**3. Message vocal Nostr → Transcription**
```yaml
id: voice-dm-transcribe
trigger:
  type: nostr_event
  filters:
    kinds: [4]
    has_audio: true

actions:
  - id: transcribe
    type: speech_to_text
    config:
      audio_source: "{{ trigger.audio_url }}"

  - id: forward
    type: telegram
    config:
      message: "Message vocal de {{ trigger.from }}: {{ actions.transcribe.response.text }}"
```

#### Options d'Implémentation

| Composant | Cloud | Local/Embarqué |
|-----------|-------|----------------|
| **STT** | Google Speech, Azure, Deepgram | Whisper.cpp, Vosk |
| **TTS** | Google TTS, Azure, ElevenLabs | Piper, espeak-ng, Coqui |
| **Wake Word** | - | Porcupine, openWakeWord |

#### Option Embarquée (Offline)

```
┌─────────────────────────────────────────────────┐
│              PipeliNostr + Voice                 │
│  ┌──────────────┐  ┌──────────────┐             │
│  │ Whisper.cpp  │  │ Piper TTS    │             │
│  │ (STT, ~1GB)  │  │ (~100MB)     │             │
│  └──────────────┘  └──────────────┘             │
│  ┌──────────────┐                               │
│  │ openWakeWord │ "Hey Pipelinostr"             │
│  │ (~50MB)      │                               │
│  └──────────────┘                               │
└─────────────────────────────────────────────────┘
```

**Modèles Whisper :**
| Modèle | Taille | RAM | Qualité |
|--------|--------|-----|---------|
| tiny | 75MB | 1GB | Basique |
| base | 150MB | 1.5GB | Correct |
| small | 500MB | 2GB | Bon |
| medium | 1.5GB | 4GB | Très bon |

**Voix Piper (TTS français) :**
- `fr_FR-siwis-medium` (~100MB, qualité naturelle)
- `fr_FR-upmc-medium` (~100MB, voix masculine)

#### Hardware Requis

| Config | STT | TTS | Wake Word |
|--------|-----|-----|-----------|
| RPi 4 2GB | Whisper tiny | Piper | openWakeWord |
| RPi 4 4GB | Whisper base | Piper | openWakeWord |
| Mini PC 8GB | Whisper small | Piper | openWakeWord |
| Avec GPU | Whisper medium+ | - | - |

#### Flux Complet Voice-First

```
         ┌─────────────────────────────────────────┐
         │           PipeliNostr Voice              │
         │                                          │
Micro ──►│ Wake Word ──► STT ──► LLM ──► Workflow  │
         │     │                            │       │
         │     └────────── TTS ◄────────────┘       │
         │                  │                       │
Speaker◄─┤──────────────────┘                       │
         └─────────────────────────────────────────┘

"Hey Pipelinostr, allume la lumière du salon"
→ [Wake] → [STT] → [LLM: intent=gpio, pin=17] → [GPIO ON]
→ [TTS] → "La lumière du salon est allumée"
```

#### Considérations

- **Latence** : STT local ~1-3s selon modèle et hardware
- **Bruit** : Filtrage nécessaire en environnement bruyant
- **Multi-langue** : Whisper supporte 99 langues
- **Privacy** : Solution locale recommandée pour commandes sensibles

---
