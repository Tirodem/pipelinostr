# PipeliNostr Backlog

## Features

### DPO / RGPD Data Processing Report

**Priority:** High
**Status:** DONE

#### Description

Générer un rapport Markdown décrivant tous les traitements de données effectués par PipeliNostr, pour conformité RGPD et intégration dans les pages Terms of Use / Privacy d'un be-BOP.

#### Déclencheurs

1. **Script CLI** : `./scripts/DPO.sh` → génère le rapport dans `reports/dpo-report.md`
2. **Commande Nostr** : DM `/dpo` à la npub de PipeliNostr → répond avec le rapport

#### Contenu du rapport (Markdown)

```markdown
# Rapport de traitement des données - PipeliNostr

Généré le : 2025-12-16 14:30:00

## Workflows

### Workflows actifs (12)

| Workflow | Description | Données traitées | Destination |
|----------|-------------|------------------|-------------|
| zulip-forward | Forward DMs to Zulip | npub expéditeur, contenu message | Zulip (stream: nostr) |
| nostr-to-email | Send email via DM | npub, contenu, adresse email destinataire | SMTP (smtp.example.com) |
| ... | ... | ... | ... |

### Workflows inactifs (11)

| Workflow | Description | Données traitées (si activé) |
|----------|-------------|------------------------------|
| auto-reply | Auto-respond to greetings | npub expéditeur |
| ... | ... | ... |

## Handlers

### Handlers actifs

| Handler | Type | Destination | Données envoyées |
|---------|------|-------------|------------------|
| email | SMTP | smtp.example.com:587 | to, subject, body |
| telegram | API | api.telegram.org | chat_id, message |
| zulip | API | zulip.example.com | stream, topic, content |
| ... | ... | ... | ... |

### Handlers inactifs

| Handler | Type | Destination (si activé) |
|---------|------|-------------------------|
| mastodon | API | mastodon.social |
| ... | ... | ... |

## Résumé des données personnelles traitées

| Catégorie | Source | Utilisé par |
|-----------|--------|-------------|
| Identifiant Nostr (npub) | Événements Nostr | Tous les workflows |
| Contenu des messages | DMs chiffrés | zulip-forward, nostr-to-email, ... |
| Adresses email | Contenu DM | nostr-to-email, nostr-to-calendar |
| Numéros de téléphone | Contenu DM | nostr-to-sms |
| Montants de paiement | Zap receipts | zap-notification, zap-to-dispenser |
```

#### Spécifications

- **Langue** : Français (multilingue à terme)
- **Niveau de détail** : Générique ("identifiant utilisateur", "contenu du message") plutôt que technique ("npub", "trigger.content")
- **Métadonnées RGPD** : Inclure si disponibles (finalité, rétention, base légale), sinon omettre

#### Implémentation

**Approche : Auto-détection par le code (pas de config supplémentaire)**

1. **Lire tous les workflows** (`config/workflows/*.yml`)
   - Extraire `id`, `name`, `description`, `enabled`
   - Parser les templates `{{ trigger.xxx }}` et `{{ match.xxx }}` pour détecter les données utilisées
   - Identifier le type d'action et sa destination

2. **Lire tous les handlers** (`config/handlers/*.yml`)
   - Extraire type, `enabled`, configuration (host, URL, etc.)
   - Masquer les secrets (tokens, passwords)

3. **Générer le rapport Markdown**
   - Grouper par état (actif/inactif)
   - Lister les données personnelles par catégorie

#### Fichiers à créer

- `src/core/dpo-reporter.ts` - Génération du rapport
- `scripts/DPO.sh` - Script CLI
- `examples/workflows/dpo-command.yml` - Workflow pour commande `/dpo`

#### Évolutions futures (optionnelles)

Permettre d'enrichir les workflows avec des métadonnées RGPD explicites :

```yaml
privacy:
  purpose: "Notification de paiement"
  retention: "30 jours"
  legal_basis: "consentement"
```

---

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
**Status:** DONE

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
**Status:** DONE

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

### RGB Protocol Handler (v0.12)

**Priority:** Medium
**Status:** Proposed

#### Description

Intégrer le protocole RGB (smart contracts Bitcoin) pour permettre l'émission, le transfert et la vérification de tokens (RGB20) et NFTs (RGB21) via workflows PipeliNostr.

#### Use Cases

1. **Token-Gating** : Conditionner l'accès à des commandes selon la possession de tokens
2. **Mint NFT à la demande** : `/mint "titre" <url>` → Crée un NFT RGB21
3. **Récompenses automatiques** : Zap reçu → Envoie token de fidélité
4. **Escrow P2P** : Créer des escrows avec libération conditionnelle
5. **Crowdfunding** : Collecter des fonds avec distribution de tokens aux backers

#### Prérequis

| Composant | Requis | Notes |
|-----------|--------|-------|
| Bitcoin Node | Oui | bitcoind ou Electrum |
| RGB Node | Oui | Self-hosted (v0.12) |
| Lightning | Optionnel | Pour transferts LN-RGB |
| BitMask SDK | Recommandé | API JavaScript |

#### Configuration

```yaml
# config/handlers/rgb.yml
rgb:
  enabled: true
  node_url: ${RGB_NODE_URL}  # http://localhost:63963

  # Wallet (pour signer)
  mnemonic: ${RGB_MNEMONIC}  # 12 mots
  # ou
  xpriv: ${RGB_XPRIV}

  # Contrats pré-déployés
  contracts:
    loyalty_token: "rgb:..."  # RGB20 fidélité
    nft_collection: "rgb:..."  # RGB21 collection
```

#### Actions supportées

```yaml
# Vérifier possession de token
- type: rgb
  config:
    operation: check_balance
    contract_id: "{{ config.contracts.loyalty_token }}"
    owner: "{{ trigger.from }}"

# Transférer tokens
- type: rgb
  config:
    operation: transfer
    contract_id: "rgb:..."
    amount: 100
    to: "{{ trigger.from }}"

# Mint NFT
- type: rgb
  config:
    operation: mint_nft
    contract_id: "rgb:..."
    metadata:
      name: "{{ match.title }}"
      image: "{{ match.url }}"
    to: "{{ trigger.from }}"
```

#### Trigger inbound (surveillance)

```yaml
trigger:
  type: rgb_transfer
  filters:
    contract_id: "rgb:..."
    min_amount: 1
```

#### Complexité

- **Installation** : Élevée (Bitcoin Node + RGB Node)
- **Développement** : ~3-5 jours
- **Maintenance** : Moyenne (mises à jour RGB Node)

#### Ressources

- [RGB Integration Guide](https://rgb.tech/integrate/)
- [RGB v0.12 Release](https://rgb.tech/blog/release-v0-12-consensus/)
- [BitMask SDK](https://github.com/nicbus/bitmask-core)

---

### Claude Workflow Explainer (`/explain <id>`)

**Priority:** Low
**Status:** Proposed

#### Description

Ajouter une commande `/explain <id>` au handler Claude pour expliquer un workflow existant en langage naturel.

#### Use Case

L'utilisateur veut comprendre ce que fait un workflow sans lire le YAML :

```
User: /explain zap-to-dispenser

PipeliNostr: 📋 Workflow "zap-to-dispenser"

Ce workflow se déclenche quand vous recevez un zap d'au moins 21 sats.

**Actions :**
1. Active un servo moteur sur GPIO 18 (mouvement 0° → 180° → 0°)
2. Enregistre le zap dans un fichier log
3. Envoie un DM de remerciement à l'expéditeur

**Prérequis :** pigpiod daemon, servo sur GPIO 18
```

#### Implémentation

- Ajouter pattern `/explain` dans `claude-activate.yml` ou créer `claude-explain.yml`
- Lire le fichier workflow demandé depuis `config/workflows/`
- Envoyer le YAML à Claude avec un prompt "explique ce workflow simplement"
- Retourner l'explication en DM

#### Sécurité

- Même restrictions que `/workflow` : Claude ne peut que lire et expliquer
- Ne pas exposer les secrets/tokens présents dans les workflows

---

### be-BOP Parser Debug Cleanup

**Priority:** Low
**Status:** Proposed

#### Description

Nettoyer les logs de debug dans `bebop.handler.ts`. Actuellement, plusieurs logs `INFO` ont été ajoutés lors du debugging du parser et devraient être changés en `DEBUG` pour la production.

#### Fichiers concernés

- `src/outbound/bebop.handler.ts` - Lignes avec `logger.info` à convertir en `logger.debug`

#### Changements

Convertir les logs suivants de `INFO` à `DEBUG` :
- `parseOrderPage: Starting`
- `parseOrderPage: Found potential SvelteKit data array`
- `parseOrderPage: Extracted JSON array`
- `parseOrderPage: Parsed data array`
- `parseOrderPage: Pattern 1 done`

---

### Braille Text Converter Workflow

**Priority:** Low
**Status:** Proposed

#### Description

Créer un workflow qui convertit le texte d'un DM en représentation Braille Unicode et le renvoie en DM.

#### Use Case

```
User: braille: Hello World

PipeliNostr: Braille: "Hello World"

⠓⠑⠇⠇⠕ ⠺⠕⠗⠇⠙
```

#### Implémentation

- Créer un helper Handlebars `{{ braille text }}` ou une action dédiée
- Utiliser les caractères Unicode Braille (U+2800 à U+28FF)
- Support du Braille Grade 1 (lettre par lettre) en priorité
- Optionnel : Braille Grade 2 (contractions) plus tard

#### Table de conversion (Grade 1)

```
A ⠁  B ⠃  C ⠉  D ⠙  E ⠑  F ⠋  G ⠛  H ⠓  I ⠊  J ⠚
K ⠅  L ⠇  M ⠍  N ⠝  O ⠕  P ⠏  Q ⠟  R ⠗  S ⠎  T ⠞
U ⠥  V ⠧  W ⠺  X ⠭  Y ⠽  Z ⠵
0 ⠴  1 ⠂  2 ⠆  3 ⠒  4 ⠲  5 ⠢  6 ⠖  7 ⠶  8 ⠦  9 ⠔
```

#### Workflow exemple

```yaml
id: nostr-to-braille
trigger:
  type: nostr_event
  filters:
    kinds: [4]
    content_pattern: "^braille:\\s*(?<text>.+)$"

actions:
  - type: nostr_dm
    config:
      to: "{{ trigger.from }}"
      content: |
        Braille: "{{ match.text }}"

        {{ braille match.text }}
```

#### Ressources

- [Unicode Braille Patterns](https://www.unicode.org/charts/PDF/U2800.pdf)
- [Braille ASCII](https://en.wikipedia.org/wiki/Braille_ASCII)

---

### Morse Code Listener (Microphone → Nostr DM)

**Priority:** Low
**Status:** Proposed

#### Description

Écouter du code Morse via un microphone connecté en GPIO (ou USB), le décoder en texte et l'envoyer en DM Nostr à une npub configurée.

#### Use Case

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Microphone  │────►│ PipeliNostr │────►│ Nostr DM    │
│ (Morse in)  │     │ (decode)    │     │ (text out)  │
└─────────────┘     └─────────────┘     └─────────────┘

Entrée audio: "... --- ..." (bips Morse)
Sortie DM: "SOS"
```

#### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Raspberry Pi                          │
│                                                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │ Microphone  │───►│ ADC         │───►│ GPIO/I2C    │  │
│  │ (analog)    │    │ (MCP3008)   │    │             │  │
│  └─────────────┘    └─────────────┘    └──────┬──────┘  │
│                                                │         │
│        OU                                      │         │
│                                                │         │
│  ┌─────────────┐                               │         │
│  │ USB Sound   │───────────────────────────────┤         │
│  │ Card + Mic  │                               │         │
│  └─────────────┘                               │         │
│                                                ▼         │
│                                       ┌─────────────┐   │
│                                       │ Morse       │   │
│                                       │ Decoder     │   │
│                                       └──────┬──────┘   │
│                                              │          │
│                                              ▼          │
│                                       ┌─────────────┐   │
│                                       │ Nostr DM    │   │
│                                       └─────────────┘   │
└──────────────────────────────────────────────────────────┘
```

#### Implémentation

1. **Inbound listener** pour audio (nouveau type de trigger)
2. **Algorithme de détection** :
   - Seuil de volume pour détecter ON/OFF
   - Mesure des durées pour distinguer points/traits
   - Détection des silences (lettres/mots)
3. **Décodage Morse → texte** (inverse du handler existant)
4. **Envoi DM** à une npub configurée

#### Configuration

```yaml
# config/handlers/morse-listener.yml
morse_listener:
  enabled: true

  # Source audio
  input: "usb"  # ou "gpio" avec ADC
  device: "/dev/snd/pcmC1D0c"  # ou "hw:1,0"

  # ou GPIO avec ADC
  # input: "gpio"
  # adc_channel: 0
  # adc_type: "mcp3008"

  # Paramètres de détection
  threshold: 0.3           # Seuil de volume (0-1)
  unit_ms: 100             # Durée estimée d'un point
  tolerance: 0.4           # Tolérance timing (40%)

  # Destination
  send_to_npub: "npub1..."  # Destinataire des messages décodés
  min_chars: 2              # Minimum de caractères avant envoi
```

#### Workflow exemple

```yaml
id: morse-listener-to-dm
trigger:
  type: morse_audio
  config:
    device: "/dev/snd/pcmC1D0c"
    threshold: 0.3

actions:
  - type: nostr_dm
    config:
      to: "npub1_destinataire"
      content: |
        Morse reçu: {{ trigger.decoded_text }}

        Brut: {{ trigger.morse_sequence }}
        Confiance: {{ trigger.confidence }}%
```

#### Matériel requis

**Configuration recommandée : USB (capture depuis buzzer KY-012)**

| # | Composant | Modèle | Prix | Lien type |
|---|-----------|--------|------|-----------|
| 1 | Carte son USB | **Sabrent AU-MMSA** | ~8€ | Amazon "Sabrent AU-MMSA" |
| 2 | Microphone | Micro cravate TRS 3.5mm | ~3-5€ | AliExpress "lavalier mic 3.5mm TRS PC" |
| 3 | Buzzer (émetteur) | AZDelivery KY-012 | ~3€ | Déjà prévu pour Morse output |

**Total : ~14€** (hors Raspberry Pi)

**Pourquoi Sabrent AU-MMSA ?**
- Plug & play sur Linux (pas de drivers)
- Entrée micro 3.5mm (TRS, pas TRRS)
- Sample rate 44.1kHz (suffisant pour Morse 300-1000Hz)
- Faible consommation, compact

**Attention micro :** Vérifier que c'est une prise **TRS 3.5mm** (3 segments) et non TRRS (4 segments pour smartphones).

```
TRS (compatible Sabrent):        TRRS (smartphones, incompatible):
    ┌─┐                              ┌─┐
    │●│ Tip (Signal)                 │●│ Tip
    ├─┤                              ├─┤
    │●│ Ring (Signal)                │●│ Ring 1
    ├─┤                              ├─┤
    │●│ Sleeve (GND)                 │●│ Ring 2
    └─┘                              ├─┤
                                     │●│ Sleeve
                                     └─┘
```

**Montage physique (couplage acoustique) :**

```
        ┌─────────────────────────────────────────────────┐
        │                   Boîtier                       │
        │                                                 │
        │   ┌──────────┐         ┌──────────┐            │
        │   │  KY-012  │  ~2cm   │   Micro  │            │
        │   │  Buzzer  │ ◄─────► │ cravate  │            │
        │   │   (•))   │         │    ●     │            │
        │   └────┬─────┘         └────┬─────┘            │
        │        │                    │                  │
        └────────┼────────────────────┼──────────────────┘
                 │                    │ Câble 3.5mm
                 │                    ▼
                 │              ┌───────────┐
                 │              │  Sabrent  │
                 │              │  AU-MMSA  │
                 │              └─────┬─────┘
                 │                    │ USB
                 │                    ▼
           GPIO 27              ┌───────────┐
                 │              │ Raspberry │
                 └──────────────┤    Pi     │
                                └───────────┘
```

**Astuce isolation bruit :** Créer un "tunnel acoustique" avec un tube carton/plastique (~3cm diamètre) entre le buzzer et le micro pour éviter le bruit ambiant.

**Vérification à la réception :**

```bash
# Vérifier que la Sabrent est détectée
arecord -l

# Tester l'enregistrement (5 secondes)
arecord -D plughw:1,0 -f S16_LE -r 44100 -d 5 test.wav

# Écouter le résultat
aplay test.wav
```

**Alternative GPIO (déconseillée) :**

| Option | Composants | Prix |
|--------|------------|------|
| GPIO + ADC | MCP3008 + micro electret + ampli | ~15€ |

L'option GPIO avec ADC (MCP3008) est déconseillée car :
- Max ~200 kHz sampling théorique, ~10-50 kHz en pratique
- Gigue de timing rend le décodage peu fiable
- Plus complexe à câbler

#### Défis techniques

- **Bruit ambiant** : Filtrage nécessaire
- **Calibration** : Vitesse variable selon l'opérateur
- **Timing** : Tolérance sur les durées points/traits
- **Latence** : Traitement temps réel

#### Ressources

- [Goertzel Algorithm](https://en.wikipedia.org/wiki/Goertzel_algorithm) - Détection de fréquence
- [node-audiorecorder](https://www.npmjs.com/package/node-audiorecorder)
- [MCP3008 avec pigpio](http://abyz.me.uk/rpi/pigpio/cif.html#spiOpen)

---

### Dolibarr ERP Handler

**Priority:** Medium
**Status:** Proposed

#### Description

Créer un handler pour Dolibarr ERP, similaire au handler Odoo existant, permettant de synchroniser des commandes et autres données vers une instance Dolibarr.

#### Use Cases

- Synchronisation commandes be-BOP → Dolibarr
- Création de tiers (clients) automatique
- Création de factures
- Recherche de produits

#### API Dolibarr

Dolibarr expose une API REST native (depuis v10+) :
- Documentation : https://wiki.dolibarr.org/index.php/Module_API_REST
- Authentification : API Key (DOLAPIKEY header)
- Base URL : `https://instance.dolibarr.org/api/index.php/`

#### Endpoints principaux

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/orders` | POST | Créer une commande |
| `/orders/{id}` | GET | Récupérer une commande |
| `/thirdparties` | POST | Créer un tiers |
| `/thirdparties` | GET | Rechercher des tiers |
| `/products` | GET | Rechercher des produits |
| `/invoices` | POST | Créer une facture |

#### Configuration proposée

```yaml
# config/handlers/dolibarr.yml
dolibarr:
  enabled: true
  url: ${DOLIBARR_URL}           # https://instance.dolibarr.org
  api_key: ${DOLIBARR_API_KEY}   # DOLAPIKEY
  default_thirdparty_id: 123     # Optionnel
  default_thirdparty_name: "Ventes be-BOP"
```

#### Actions supportées

```yaml
actions:
  # Créer une commande
  - type: dolibarr
    config:
      action: create_order
      data: "{{ actions.parse_bebop.response }}"

  # Rechercher un tiers
  - type: dolibarr
    config:
      action: search_thirdparty
      filters:
        email: "client@example.com"

  # Créer un tiers
  - type: dolibarr
    config:
      action: create_thirdparty
      data:
        name: "Nouveau Client"
        email: "nouveau@example.com"

  # Rechercher un produit
  - type: dolibarr
    config:
      action: search_product
      filters:
        ref: "PROD001"
```

#### Implémentation

- Fichier : `src/outbound/dolibarr.handler.ts`
- ~250 lignes (plus simple qu'Odoo car API REST native)
- Réutiliser le pattern de `odoo.handler.ts`

#### Différences avec Odoo

| Aspect | Odoo | Dolibarr |
|--------|------|----------|
| API | JSON-RPC | REST |
| Auth | Session cookie | API Key header |
| Modèles | `sale.order`, `res.partner` | `orders`, `thirdparties` |
| Complexité | Plus complexe | Plus simple |

---

### Bitcoin & Lightning Handlers

**Priority:** Medium
**Status:** Proposed

#### Description

Ajouter des handlers pour gérer les paiements Bitcoin on-chain et Lightning, permettant de surveiller les dons entrants et de générer des invoices.

#### 1. Handler Mempool xpub (Inbound - On-chain)

Surveiller une xpub pour détecter les nouvelles transactions entrantes sur les adresses dérivées.

```yaml
# config/handlers/mempool-xpub.yml
mempool_xpub:
  enabled: true
  xpub: ${BITCOIN_XPUB}
  # ou zpub pour SegWit natif
  # zpub: ${BITCOIN_ZPUB}

  poll_interval_seconds: 60  # Toutes les minutes
  api_url: "https://mempool.space/api"  # ou instance locale

  # Dérivation
  derivation_gap: 20         # Nombre d'adresses à surveiller
  address_type: "bech32"     # legacy, p2sh-segwit, bech32
```

**Trigger workflow :**
```yaml
id: onchain-donation-alert
trigger:
  type: mempool_xpub
  filters:
    min_amount_sats: 1000    # Ignorer dust

actions:
  - id: notify
    type: zulip
    config:
      content: |
        ⛓️ Don on-chain reçu!
        Montant: {{ trigger.amount_sats }} sats
        Adresse: {{ trigger.address }}
        TX: {{ trigger.txid }}
        Confirmations: {{ trigger.confirmations }}
```

**Variables trigger disponibles :**
- `trigger.txid` : ID de la transaction
- `trigger.address` : Adresse de réception
- `trigger.address_index` : Index de dérivation
- `trigger.amount_sats` : Montant en satoshis
- `trigger.confirmations` : Nombre de confirmations
- `trigger.block_height` : Hauteur du bloc (si confirmé)
- `trigger.sender_addresses` : Adresses d'envoi

#### 2. Handler Phoenixd (Inbound - Lightning)

Intégrer phoenixd (daemon Phoenix Wallet) pour gérer les paiements Lightning.

**Installation phoenixd :**
```bash
# Télécharger phoenixd
curl -L https://github.com/ACINQ/phoenixd/releases/latest/download/phoenixd-linux-x64.zip -o phoenixd.zip
unzip phoenixd.zip

# Lancer le daemon
./phoenixd --agree-to-terms-of-service

# API disponible sur http://localhost:9740
```

**Configuration handler :**
```yaml
# config/handlers/phoenixd.yml
phoenixd:
  enabled: true
  api_url: "http://localhost:9740"
  api_password: ${PHOENIXD_API_PASSWORD}  # Généré au premier lancement

  # Mode écoute (inbound)
  webhook_mode: true
  listen_port: 9741  # Pour recevoir les webhooks phoenixd
```

**Trigger workflow (paiement reçu) :**
```yaml
id: lightning-donation-alert
trigger:
  type: phoenixd_payment
  filters:
    min_amount_sats: 100

actions:
  - id: notify
    type: telegram
    config:
      text: |
        ⚡ Don Lightning reçu!
        Montant: {{ trigger.amount_sats }} sats
        Description: {{ trigger.description }}
        Payment hash: {{ trigger.payment_hash | truncate:16 }}
```

**Variables trigger disponibles :**
- `trigger.payment_hash` : Hash du paiement
- `trigger.amount_sats` : Montant reçu
- `trigger.description` : Description de l'invoice
- `trigger.created_at` : Timestamp de réception
- `trigger.preimage` : Preimage du paiement

#### 3. Handler Phoenixd (Outbound - Génération d'invoices)

Générer des invoices Lightning ou des adresses on-chain à la demande.

**Workflow génération invoice Lightning :**
```yaml
id: generate-lightning-invoice
trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^invoice\\s+(?<amount>\\d+)\\s*(?<description>.*)?"

actions:
  - id: create_invoice
    type: phoenixd
    config:
      operation: create_invoice
      amount_sats: "{{ match.amount }}"
      description: "{{ match.description | default: 'Don via PipeliNostr' }}"
      expiry_seconds: 3600

  - id: reply
    type: nostr_dm
    config:
      to: "{{ trigger.from }}"
      content: |
        ⚡ Invoice Lightning créée:

        Montant: {{ match.amount }} sats

        {{ actions.create_invoice.response.bolt11 }}

        Expire dans 1 heure.
```

**Workflow génération adresse on-chain :**
```yaml
id: generate-onchain-address
trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^address$"

actions:
  - id: derive_address
    type: bitcoin_xpub
    config:
      operation: derive_next
      xpub: ${BITCOIN_XPUB}

  - id: reply
    type: nostr_dm
    config:
      to: "{{ trigger.from }}"
      content: |
        ⛓️ Adresse Bitcoin:

        {{ actions.derive_address.response.address }}

        Index: {{ actions.derive_address.response.index }}
```

#### 4. Workflow Unifié : Don Multi-Rail

```yaml
id: donation-request
trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^don(?:ate)?\\s+(?<amount>\\d+)(?:\\s+(?<rail>ln|btc))?"

actions:
  # Lightning par défaut
  - id: ln_invoice
    type: phoenixd
    when: "match.rail !== 'btc'"
    config:
      operation: create_invoice
      amount_sats: "{{ match.amount }}"
      description: "Don PipeliNostr"

  # On-chain si demandé
  - id: btc_address
    type: bitcoin_xpub
    when: "match.rail === 'btc'"
    config:
      operation: derive_next

  - id: reply_ln
    type: nostr_dm
    when: "match.rail !== 'btc'"
    config:
      to: "{{ trigger.from }}"
      content: |
        ⚡ Invoice Lightning ({{ match.amount }} sats):
        {{ actions.ln_invoice.response.bolt11 }}

  - id: reply_btc
    type: nostr_dm
    when: "match.rail === 'btc'"
    config:
      to: "{{ trigger.from }}"
      content: |
        ⛓️ Adresse Bitcoin ({{ match.amount }} sats attendus):
        {{ actions.btc_address.response.address }}
```

**Usage :**
```
donate 1000        → Invoice Lightning 1000 sats
donate 1000 ln     → Invoice Lightning 1000 sats
donate 50000 btc   → Adresse on-chain
```

#### Architecture Complète

```
┌─────────────────────────────────────────────────────────────────┐
│                     PipeliNostr + Bitcoin                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INBOUND (Surveillance)                                         │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ Mempool API     │     │ Phoenixd        │                   │
│  │ (poll xpub)     │     │ (webhook)       │                   │
│  │ ⛓️ On-chain     │     │ ⚡ Lightning    │                   │
│  └────────┬────────┘     └────────┬────────┘                   │
│           │                       │                             │
│           └───────────┬───────────┘                             │
│                       ▼                                         │
│              ┌─────────────────┐                                │
│              │ Workflow Engine │                                │
│              └────────┬────────┘                                │
│                       │                                         │
│  OUTBOUND (Génération)│                                         │
│           ┌───────────┴───────────┐                             │
│           ▼                       ▼                             │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ bitcoin_xpub    │     │ phoenixd        │                   │
│  │ derive_next     │     │ create_invoice  │                   │
│  │ ⛓️ Adresse     │     │ ⚡ BOLT11       │                   │
│  └─────────────────┘     └─────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Prérequis

**On-chain :**
- xpub/zpub d'un wallet HD (Electrum, Sparrow, etc.)
- Accès API mempool.space (public ou self-hosted)

**Lightning :**
- phoenixd installé et synchronisé
- ~100k sats pour la liquidité initiale (auto-gérée par Phoenix)

#### Considérations

- **Privacy xpub** : Ne jamais exposer la xpub publiquement
- **Gap limit** : Surveiller suffisamment d'adresses pour ne pas manquer de paiements
- **Phoenixd liquidity** : Phoenix gère automatiquement les canaux mais prend des frais
- **Confirmations** : Configurer le nombre de confirmations requises selon le montant
- **Rate limiting** : Mempool.space API a des limites (self-host recommandé pour usage intensif)

#### Alternatives à Phoenixd

| Solution | Type | Complexité | Notes |
|----------|------|------------|-------|
| **Phoenixd** | Non-custodial | Faible | Recommandé, auto-gestion liquidité |
| **LND** | Non-custodial | Élevée | Plus de contrôle, plus complexe |
| **Core Lightning** | Non-custodial | Élevée | Léger, plugins extensibles |
| **LNbits** | Semi-custodial | Moyenne | API simple, multi-wallet |
| **Alby Hub** | Non-custodial | Faible | Interface web, NWC support |

---

### SMS Gateway for Android (capcom6)

**Priority:** Medium
**Status:** Proposed

#### Description

Intégrer **SMS Gateway for Android** comme alternative open source à Traccar SMS Gateway pour l'envoi et la réception de SMS.

#### Source

- Repo: https://github.com/capcom6/android-sms-gateway
- Docs: https://docs.sms-gate.app
- Licence: Apache-2.0

#### Pourquoi ce choix

| Avantage | Description |
|----------|-------------|
| Open source | Apache-2.0, code auditable |
| Self-hosted | Mode Local = aucun tiers externe |
| Bidirectionnel | Envoi ET réception de SMS |
| Webhooks natifs | Notification automatique des SMS entrants |
| Multi-SIM | Choix de la SIM pour l'envoi |
| Android 5.0+ | Compatible anciens téléphones |

#### Architecture d'intégration

**SMS → Nostr (réception) :**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ SMS entrant │────►│ SMS Gateway │────►│ PipeliNostr │
│ (téléphone) │     │ (webhook)   │     │ (kind 14?)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

1. SMS Gateway reçoit un SMS sur le téléphone Android
2. Webhook POST vers PipeliNostr :
```json
{
  "event": "sms:received",
  "payload": {
    "message": "contenu du SMS",
    "phoneNumber": "+33612345678",
    "receivedAt": "2024-12-19T10:00:00Z"
  }
}
```
3. PipeliNostr transforme en event Nostr (kind configurable)

**Nostr → SMS (envoi) :**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Nostr DM    │────►│ PipeliNostr │────►│ SMS Gateway │
│ "sms:+33..."│     │ (handler)   │     │ (API REST)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

1. PipeliNostr reçoit un event Nostr (ex: kind 4 DM)
2. POST vers l'API locale du téléphone :
```bash
POST http://<phone-ip>:8080/message
Authorization: Basic <base64>
{
  "phoneNumbers": ["+33612345678"],
  "message": "contenu"
}
```

#### Configuration handler

```yaml
# config/handlers/sms-gateway.yml
sms_gateway:
  enabled: true
  mode: local  # local | cloud | private

  # API du téléphone Android
  host: "192.168.1.50"
  port: 8080
  credentials:
    username: ${SMS_GATEWAY_USER}
    password: ${SMS_GATEWAY_PASS}

  # Réception SMS (inbound)
  webhook:
    enabled: true
    path: "/webhooks/sms-gateway"
    events: ["sms:received"]

  # Mapping Nostr
  mapping:
    inbound:
      kind: 14           # Kind Nostr pour SMS reçus (ou custom)
      tagPhone: true     # Ajouter tag ["phone", "+33..."]
    outbound:
      triggerKinds: [4, 14]    # Kinds qui déclenchent l'envoi
      phoneFromTag: "phone"    # Extraire le numéro du tag

  # Options d'envoi
  sim_number: 1  # 1 ou 2 pour dual-SIM
  with_delivery_report: true
```

#### Workflow exemple (envoi)

```yaml
id: nostr-to-sms-gateway
name: Send SMS via SMS Gateway
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^sms:\\s*(?<phone>\\+?[0-9]+)\\s+(?<message>.+)$"

actions:
  - id: send_sms
    type: sms_gateway
    config:
      to: "{{ match.phone }}"
      message: "{{ match.message }}"

  - id: confirm
    type: nostr_dm
    config:
      to: "{{ trigger.from }}"
      content: "SMS envoyé à {{ match.phone }}"
```

#### Workflow exemple (réception)

```yaml
id: sms-to-nostr-dm
name: Forward received SMS to Nostr DM
enabled: true

trigger:
  type: sms_gateway_webhook
  filters:
    events: ["sms:received"]

actions:
  - id: forward_dm
    type: nostr_dm
    config:
      to: "npub1_admin..."
      content: |
        SMS reçu de {{ trigger.phoneNumber }}:
        {{ trigger.message }}
```

#### Comparaison avec Traccar SMS

| Aspect | Traccar SMS | SMS Gateway |
|--------|-------------|-------------|
| Envoi SMS | Oui | Oui |
| Réception SMS | Non | Oui (webhook) |
| Open source | Non | Oui (Apache-2.0) |
| Mode cloud | Non | Oui (optionnel) |
| Multi-SIM | Non | Oui |
| API | REST simple | REST + webhooks |

#### Implémentation

- Fichier : `src/outbound/sms-gateway.handler.ts`
- Fichier : `src/inbound/sms-gateway-webhook.ts` (pour réception)
- Complexité : ~200-300 lignes
- Tests : Téléphone Android avec l'app installée

#### Prérequis

1. Téléphone Android 5.0+ avec carte SIM
2. App SMS Gateway installée : [Play Store](https://play.google.com/store/apps/details?id=me.capcom.smsgateway)
3. Téléphone et PipeliNostr sur le même réseau (mode local)

#### Tâches d'implémentation

- [ ] Créer le module handler `sms-gateway.handler.ts`
- [ ] Implémenter le client HTTP pour l'API d'envoi
- [ ] Implémenter le endpoint webhook pour la réception
- [ ] Gestion des credentials et retry logic
- [ ] Tests avec téléphone Android
- [ ] Documentation dans `docs/SMS-GATEWAY-SETUP.md`

---

### Claude API Status via DM Nostr

**Priority:** Low
**Status:** CANCELLED

#### Description

Ajouter un workflow permettant de consulter sa consommation de tokens Claude API via un DM Nostr avec la commande `/claude status`.

**ANNULÉ** : L'API Anthropic ne fournit pas d'endpoint pour consulter l'usage/quota. Ces informations sont uniquement disponibles sur https://console.anthropic.com/settings/usage.

---

### Claude Smart Reply (Bot conversationnel)

**Priority:** Medium
**Status:** Proposed

#### Description

Utiliser Claude pour répondre intelligemment aux DMs Nostr, créant un bot conversationnel personnalisable.

#### Use Case

```
User DM: "Salut, tu peux m'expliquer comment fonctionne le Lightning Network ?"

Bot répond: "Le Lightning Network est une solution de seconde couche pour Bitcoin
qui permet des transactions instantanées et quasi-gratuites..."
```

#### Workflow exemple

```yaml
id: claude-smart-reply
name: Claude Smart Reply Bot
enabled: false

trigger:
  type: nostr_event
  filters:
    kinds: [4, 1059]
    from_whitelist: true
    # Ne pas matcher les commandes existantes
    content_pattern: "^(?!/)"

actions:
  - id: ask_claude
    type: claude
    config:
      action: reply
      system_prompt: |
        Tu es l'assistant personnel de Jean.
        Réponds poliment en français.
        Sois concis (max 500 caractères).
      message: "{{ trigger.content }}"

  - id: send_reply
    type: nostr_dm
    config:
      to: "{{ trigger.pubkey }}"
      content: "{{ actions.ask_claude.response.content }}"
```

#### Configuration handler

Dans `config/handlers/claude.yml` :
```yaml
enabled: true
api_key: ${ANTHROPIC_API_KEY}
model: claude-3-5-haiku-20241022
max_tokens: 1024
```

#### Tâches d'implémentation

- [ ] Ajouter action `reply` au claude.handler.ts
- [ ] Créer workflow exemple `claude-smart-reply.yml.example`
- [ ] Supporter `system_prompt` personnalisable
- [ ] Limiter le coût (max_tokens, rate limiting)

---

### Claude Intent Classifier (Routage intelligent)

**Priority:** Medium
**Status:** Proposed

#### Description

Utiliser Claude pour classifier l'intention d'un message et router vers le workflow approprié, sans regex complexes.

#### Use Case

```
User: "Allume la lumière du salon"
→ Claude classifie: intent=gpio, device=salon, action=on
→ Route vers workflow nostr-to-gpio

User: "Envoie un message sur Telegram pour dire bonjour"
→ Claude classifie: intent=telegram, message="bonjour"
→ Route vers workflow nostr-to-telegram
```

#### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  DM entrant     │────►│ Claude classify │────►│ Workflow ciblé  │
│  (texte libre)  │     │ (intent+params) │     │ (exécution)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

#### Workflow exemple

```yaml
id: claude-intent-router
name: Claude Intent Router
enabled: false

trigger:
  type: nostr_event
  filters:
    kinds: [4, 1059]
    from_whitelist: true

actions:
  - id: classify
    type: claude
    config:
      action: classify
      intents:
        - id: gpio
          description: "Contrôler un appareil domotique (lumière, etc.)"
          params: ["device", "action"]
        - id: telegram
          description: "Envoyer un message sur Telegram"
          params: ["message"]
        - id: email
          description: "Envoyer un email"
          params: ["to", "subject", "body"]
        - id: unknown
          description: "Intention non reconnue"
      message: "{{ trigger.content }}"

  # Exécuter le workflow correspondant selon l'intent
  - id: route_gpio
    type: workflow_trigger
    when: "actions.classify.response.intent == 'gpio'"
    config:
      workflow_id: nostr-to-gpio
      params:
        device: "{{ actions.classify.response.params.device }}"
        action: "{{ actions.classify.response.params.action }}"

  - id: route_telegram
    type: workflow_trigger
    when: "actions.classify.response.intent == 'telegram'"
    config:
      workflow_id: nostr-to-telegram
      params:
        message: "{{ actions.classify.response.params.message }}"
```

#### Tâches d'implémentation

- [ ] Ajouter action `classify` au claude.handler.ts
- [ ] Définir format de réponse structuré (JSON)
- [ ] Créer workflow exemple
- [ ] Ajouter action `workflow_trigger` pour chaînage dynamique

---

### Claude API Status via DM Nostr (ORIGINAL - DEPRECATED)

L'entrée originale ci-dessous est conservée pour référence historique.

#### Use Case

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ User envoie     │────►│ PipeliNostr     │────►│ Claude API      │
│ /claude status  │     │                 │     │ /usage endpoint │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                 │                       │
                                 │◄──────────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Réponse DM      │
                        │ avec stats      │
                        └─────────────────┘
```

#### Workflow exemple

```yaml
id: claude-status
name: Claude API Status
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^/claude\\s+status$"

actions:
  - id: get_usage
    type: http
    config:
      url: "https://api.anthropic.com/v1/usage"
      method: GET
      headers:
        x-api-key: "{{ env.ANTHROPIC_API_KEY }}"
        anthropic-version: "2023-06-01"

  - id: reply
    type: nostr_dm
    config:
      to: "{{ trigger.from }}"
      content: |
        Claude API Status:
        - Tokens utilisés: {{ actions.get_usage.response.tokens_used | number }}
        - Limite: {{ actions.get_usage.response.tokens_limit | number }}
        - Période: {{ actions.get_usage.response.period }}
        - Restant: {{ actions.get_usage.response.tokens_remaining | number }}
```

#### Notes

- Nécessite la variable d'environnement `ANTHROPIC_API_KEY`
- L'endpoint `/v1/usage` de l'API Anthropic doit être vérifié (peut ne pas exister ou avoir une structure différente)
- Alternative : utiliser l'API de billing/admin si disponible
- Possibilité d'ajouter d'autres commandes : `/claude models`, `/claude limits`

#### Tâches d'implémentation

- [ ] Vérifier l'existence d'un endpoint usage dans l'API Anthropic
- [ ] Créer le workflow `claude-status.yml`
- [ ] Tester avec une clé API valide
- [ ] Documenter les commandes disponibles

---

### PipeliNostr System Status via DM

**Priority:** Medium
**Status:** DONE

#### Description

Ajouter un handler et workflow permettant de consulter l'état système de PipeliNostr via un DM Nostr avec la commande `/pipelinostr status`.

#### Informations retournées

1. **Version** : Commit Git déployé (hash court + branche)
2. **Workflows** : Liste des workflows actifs/inactifs
3. **Handlers** : Liste des handlers enregistrés
4. **Dernières exécutions** : 10 dernières exécutions de workflows
5. **Ressources système** : RAM, CPU, disque
6. **OS** : Type, version, hostname, uptime

#### Implémentation

- **Handler** : `src/outbound/system.handler.ts`
  - Action `status` : retourne toutes les infos formatées
  - Action `health` : health check rapide (database, disk, memory)
- **Workflow** : `examples/workflows/pipelinostr-status.yml.example`
- **Commande** : `/pipelinostr status`

#### Exemple de réponse

```
📊 PipeliNostr Status

🔖 Version: 2b4e277 (main)

📋 Workflows: 12/15 enabled
  ✅ zulip-forward: Forward DMs to Zulip
  ✅ zap-notification: Zap notifications
  ❌ auto-reply: Auto-respond (disabled)

🔌 Handlers: 12
  http, nostr_dm, nostr_note, telegram, zulip, ...

📜 Recent executions (10):
  ✅ zulip-forward
  ✅ zap-notification
  ❌ nostr-to-email (failed)

💻 System: Linux 5.15.0
  Platform: linux/arm64
  Hostname: pipelinostr-rpi
  Uptime: 5d 12h 30m

📊 Resources:
  CPU: 4 cores (Cortex-A72)
  RAM: 512MB / 4096MB (12%)
  Disk: 8GB / 32GB (25%)

🕐 2025-12-20T15:30:00.000Z
```

---

### Performance Monitoring & Logging

**Priority:** Medium
**Status:** Proposed

#### Description

Ajouter un système de monitoring des performances de PipeliNostr pour suivre la consommation RAM/CPU au repos et pendant l'exécution des workflows.

#### Spécifications

**Stockage (nouvelle table SQLite):**

```sql
CREATE TABLE performance_log (
  id INTEGER PRIMARY KEY,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  type TEXT NOT NULL,  -- 'idle' | 'workflow_start' | 'workflow_end'
  workflow_id TEXT,
  workflow_name TEXT,

  -- Process Node.js
  heap_used_mb REAL,
  heap_total_mb REAL,
  rss_mb REAL,

  -- CPU (temps cumulé)
  cpu_user_ms INTEGER,
  cpu_system_ms INTEGER,

  -- Système
  load_avg_1m REAL,
  system_free_mb REAL,
  system_total_mb REAL
);
```

**Types de mesures:**

| Type | Quand | Données capturées |
|------|-------|-------------------|
| `idle` | Toutes les 5 minutes (configurable) | Mémoire + CPU + load |
| `workflow_start` | Avant exécution workflow | Snapshot avant |
| `workflow_end` | Après exécution workflow | Snapshot après + delta |

**Configuration:**
- Intervalle idle : 5 minutes (configurable dans config.yml)
- Rétention : 100 dernières mesures
- Alertes : mécanisme préparé mais inactif par défaut

**CLI:**

```bash
# Résumé global
./scripts/pipelinostr.sh perf

# Dernière mesure idle
./scripts/pipelinostr.sh perf idle --last

# Moyenne/médiane des 10 dernières mesures idle
./scripts/pipelinostr.sh perf idle --stats

# Consommation par workflow (moyenne)
./scripts/pipelinostr.sh perf workflows

# Détail d'un workflow spécifique
./scripts/pipelinostr.sh perf workflow zulip-forward
```

**Exemple d'output:**

```
=== PipeliNostr Performance ===

Idle (last 10 samples, every 5min):
  Heap: 45MB avg / 42MB median (38-52MB range)
  RSS:  98MB avg / 95MB median
  Load: 0.12 avg

Per-workflow (last 10 executions):
  zulip-forward:     +2.1MB heap, 45ms avg
  zap-notification:  +1.8MB heap, 38ms avg
  pipelinostr-status: +0.5MB heap, 12ms avg
```

#### Tâches d'implémentation

- [ ] Créer table performance_log dans database.ts
- [ ] Créer classe PerformanceMonitor avec capture des métriques
- [ ] Ajouter sampling idle (setInterval 5min)
- [ ] Intégrer avec workflow engine (hooks before/after)
- [ ] Ajouter cleanup rétention (garder 100 dernières)
- [ ] Préparer mécanisme d'alertes (inactif)
- [ ] Ajouter commandes `perf` au CLI pipelinostr.sh

---

### GPIO Bouton Poussoir de Secours (Zap-to-Dispenser Fallback)

**Priority:** Medium
**Status:** Proposed

#### Description

Ajouter un bouton poussoir physique qui déclenche l'action du servomoteur du distributeur même en l'absence de connexion réseau ou de zap. Mode "offline fallback" pour le workflow `zap-to-dispenser`.

#### Use Case

```
┌─────────────────────────────────────────────────────────────┐
│                    ZAP-TO-DISPENSER                          │
│                                                              │
│   Mode Normal (online):                                      │
│   ┌─────────┐     ┌─────────────┐     ┌─────────┐          │
│   │ Zap     │────►│ PipeliNostr │────►│ Servo   │          │
│   │ (Nostr) │     │             │     │ (GPIO)  │          │
│   └─────────┘     └─────────────┘     └─────────┘          │
│                                                              │
│   Mode Fallback (offline):                                   │
│   ┌─────────┐     ┌─────────────┐     ┌─────────┐          │
│   │ Bouton  │────►│ GPIO        │────►│ Servo   │          │
│   │ (GPIO)  │     │ Listener    │     │ (GPIO)  │          │
│   └─────────┘     └─────────────┘     └─────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Implémentation

**Option A : Listener GPIO intégré à PipeliNostr**

```yaml
# config/handlers/gpio.yml
gpio:
  enabled: true

  # Écoute bouton (inbound)
  inputs:
    - pin: 17
      name: "dispenser_button"
      edge: "falling"          # falling | rising | both
      debounce_ms: 200         # Anti-rebond
      pull: "up"               # up | down | none (pull-up interne)
```

```yaml
# Workflow déclenché par bouton
id: button-to-dispenser
name: Manual Dispenser Trigger
enabled: true

trigger:
  type: gpio_input
  filters:
    pin: 17
    edge: falling

actions:
  - id: dispense
    type: gpio
    config:
      pin: 18
      action: servo
      angle: 180
      duration: 1000
      return_angle: 0

  - id: log_local
    type: file
    config:
      path: "/var/log/pipelinostr/manual-dispense.log"
      content: "{{ now | date }} - Manual dispense triggered\n"
      append: true
```

**Option B : Script externe avec systemd (sans PipeliNostr)**

```bash
#!/bin/bash
# /usr/local/bin/manual-dispense.sh
# Déclenché par systemd sur événement GPIO

pigs s 18 2500  # Servo à 180°
sleep 1
pigs s 18 500   # Retour à 0°
echo "$(date) - Manual dispense" >> /var/log/manual-dispense.log
```

```ini
# /etc/systemd/system/dispenser-button.service
[Unit]
Description=Manual Dispenser Button

[Service]
Type=simple
ExecStart=/usr/bin/gpiomon --falling-edge --num-events=1 gpiochip0 17
ExecStartPost=/usr/local/bin/manual-dispense.sh
Restart=always

[Install]
WantedBy=multi-user.target
```

#### Câblage

```
RASPBERRY PI                    BOUTON POUSSOIR
Pin 11 [GPIO17]  ●──────────────● Contact 1
Pin 9  [GND]     ●──────────────● Contact 2

Note: Utiliser la résistance pull-up interne du RPi
      Le bouton tire GPIO17 vers GND quand pressé
```

#### Matériel requis

| Composant | Prix | Notes |
|-----------|------|-------|
| Bouton poussoir 12mm | ~1€ | Momentané, normalement ouvert |
| Câbles dupont | ~1€ | 2 câbles femelle-femelle |

#### Considérations

- **Debounce** : Filtrer les rebonds mécaniques (200ms recommandé)
- **Pull-up** : Utiliser le pull-up interne du RPi pour éviter les faux déclenchements
- **Logging** : Garder une trace des déclenchements manuels pour audit
- **LED indicateur** : Optionnel - allumer une LED pendant l'action

#### Tâches d'implémentation

- [ ] Ajouter `GpioInputListener` dans `src/inbound/gpio-input.ts`
- [ ] Supporter trigger `type: gpio_input` dans workflow-matcher
- [ ] Debounce et gestion des edges (rising/falling/both)
- [ ] Tests avec bouton physique
- [ ] Documentation câblage

---

### Afficheur Digital GPIO pour Pseudonyme Nostr

**Priority:** Medium
**Status:** Proposed

#### Description

Afficher le pseudonyme (display_name ou name) du profil Nostr de l'expéditeur d'un DM sur un écran LCD/OLED connecté en GPIO (I2C ou SPI).

#### Use Case

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ DM Nostr    │────►│ PipeliNostr │────►│ Écran LCD   │
│ de @alice   │     │ (fetch      │     │ "alice"     │
│             │     │  profile)   │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
```

#### Types d'afficheurs supportés

| Type | Interface | Résolution | Prix | Notes |
|------|-----------|------------|------|-------|
| **LCD 16x2** | I2C (PCF8574) | 16 chars x 2 lignes | ~5€ | Classique, rétroéclairé |
| **LCD 20x4** | I2C (PCF8574) | 20 chars x 4 lignes | ~8€ | Plus de texte |
| **OLED SSD1306** | I2C | 128x64 pixels | ~5€ | Graphique, contraste élevé |
| **OLED SSD1306** | SPI | 128x64 pixels | ~5€ | Plus rapide |
| **E-Ink** | SPI | Variable | ~15€ | Très basse conso, lent |

#### Configuration handler

```yaml
# config/handlers/display.yml
display:
  enabled: true

  type: lcd_i2c          # lcd_i2c | oled_i2c | oled_spi | e_ink
  i2c_address: 0x27      # Adresse I2C (0x27 ou 0x3F pour LCD, 0x3C pour OLED)

  # Dimensions
  cols: 16               # Caractères par ligne (LCD)
  rows: 2                # Nombre de lignes (LCD)
  # ou
  width: 128             # Pixels (OLED)
  height: 64             # Pixels (OLED)

  # Options
  backlight: true        # LCD uniquement
  scroll_long_text: true # Défiler si texte trop long
  scroll_speed_ms: 300   # Vitesse défilement
  display_duration_ms: 5000  # Durée affichage avant effacement
```

#### Workflow exemple

```yaml
id: dm-to-display
name: Show sender name on LCD
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true

actions:
  # Récupérer le profil Nostr de l'expéditeur
  - id: fetch_profile
    type: nostr_profile
    config:
      pubkey: "{{ trigger.pubkey }}"

  # Afficher sur l'écran
  - id: show_name
    type: display
    config:
      line1: "DM de:"
      line2: "{{ actions.fetch_profile.response.display_name | default: actions.fetch_profile.response.name | default: trigger.from | truncate:16 }}"
      duration_ms: 10000
```

#### Action `nostr_profile` (nouvelle)

Pour récupérer le profil (kind 0) d'une npub :

```yaml
- id: fetch_profile
  type: nostr_profile
  config:
    pubkey: "{{ trigger.pubkey }}"
    # ou
    npub: "{{ trigger.from }}"
    timeout_ms: 5000

# Response:
# {
#   "name": "alice",
#   "display_name": "Alice",
#   "about": "...",
#   "picture": "https://...",
#   "nip05": "alice@example.com",
#   ...
# }
```

#### Câblage LCD I2C (16x2)

```
RASPBERRY PI                    LCD I2C (PCF8574)
Pin 1  [3.3V]    ●──────────────● VCC
Pin 6  [GND]     ●──────────────● GND
Pin 3  [GPIO2/SDA] ●────────────● SDA
Pin 5  [GPIO3/SCL] ●────────────● SCL
```

#### Câblage OLED SSD1306 I2C

```
RASPBERRY PI                    OLED SSD1306
Pin 1  [3.3V]    ●──────────────● VCC
Pin 6  [GND]     ●──────────────● GND
Pin 3  [GPIO2/SDA] ●────────────● SDA
Pin 5  [GPIO3/SCL] ●────────────● SCL
```

#### Librairies Node.js

| Écran | Package npm | Notes |
|-------|-------------|-------|
| LCD I2C | `lcd` ou `raspberrypi-liquid-crystal` | PCF8574 backpack |
| OLED SSD1306 | `ssd1306-i2c-js` ou `oled-js` | Via I2C |
| E-Ink | `epd-waveshare` | Waveshare displays |

#### Implémentation

- Fichier : `src/outbound/display.handler.ts`
- Action : `nostr_profile` dans `src/outbound/nostr.handler.ts` (ou nouveau fichier)
- Complexité : ~200-300 lignes
- Dépendance : `i2c-bus` + lib spécifique écran

#### Tâches d'implémentation

- [ ] Créer `display.handler.ts` avec support LCD I2C
- [ ] Ajouter action `nostr_profile` pour fetch kind 0
- [ ] Support OLED SSD1306 (optionnel)
- [ ] Gestion du scroll pour texte long
- [ ] Tests avec LCD 16x2
- [ ] Documentation câblage dans `docs/GPIO-DISPLAY-SETUP.md`

---

### PipeliNostr sur Téléphone (Android/iOS)

**Priority:** Low
**Status:** Research

#### Description

Évaluer les possibilités de faire tourner PipeliNostr sur un téléphone Android ou iOS, avec ou sans portage du code.

#### Options d'exécution

| Option | Platform | Effort | Limitations |
|--------|----------|--------|-------------|
| **Termux + Node.js** | Android | Faible | Pas de GPIO, background limité |
| **UserLAnd** | Android | Faible | Linux complet, mêmes limites |
| **iSH** | iOS | Faible | Alpine Linux émulé, lent |
| **React Native port** | Android/iOS | Très élevé | Réécriture majeure |
| **Expo + Node backend** | Android/iOS | Élevé | App native + serveur local |
| **PWA + Service Worker** | Web | Moyen | Pas de WebSocket stable en background |

#### Option 1 : Termux (Android) - Recommandé

**Installation :**
```bash
# Installer Termux depuis F-Droid (pas Play Store)
pkg update && pkg upgrade
pkg install nodejs-lts git

# Cloner PipeliNostr
git clone https://github.com/user/pipelinostr
cd pipelinostr
npm install
npm run build
npm start
```

**Avantages :**
- Code identique, aucune modification
- Node.js 20+ disponible
- Accès réseau complet

**Limitations :**
- Pas d'accès GPIO (pas de hardware control)
- Background execution limitée (Android tue les apps)
- Batterie : consommation significative
- Pas de notifications natives

**Solutions background :**
- `termux-wake-lock` : Empêche la mise en veille
- `termux-services` : Gestion services style init.d
- Notification persistante : Garde l'app en foreground

```bash
# Garder Termux actif
termux-wake-lock

# Lancer comme service
mkdir -p ~/.termux/boot
echo "cd ~/pipelinostr && npm start" > ~/.termux/boot/pipelinostr.sh
chmod +x ~/.termux/boot/pipelinostr.sh
```

#### Option 2 : UserLAnd (Android)

Distribution Linux complète dans une app Android.

```bash
# Installer UserLAnd, choisir Ubuntu/Debian
# Puis même process que serveur Linux classique
sudo apt update
sudo apt install nodejs npm
# ...
```

**Avantages :** Environnement Linux complet
**Inconvénients :** Plus lourd, même limitations background

#### Option 3 : iSH (iOS)

Émulateur Alpine Linux pour iOS (App Store).

```bash
apk add nodejs npm git
# ...
```

**Limitations :** Très lent (émulation x86), pas de background

#### Option 4 : PWA avec Backend Local

Architecture hybride :

```
┌─────────────────────────────────────────────────┐
│                  TÉLÉPHONE                       │
│  ┌───────────────┐     ┌───────────────────┐   │
│  │ PWA (UI)      │◄───►│ PipeliNostr       │   │
│  │ - Dashboard   │     │ (Termux/Service)  │   │
│  │ - Config      │     │ - Core engine     │   │
│  │ - Logs        │     │ - Handlers        │   │
│  └───────────────┘     └───────────────────┘   │
└─────────────────────────────────────────────────┘
```

#### Option 5 : Portage React Native (Non recommandé)

Effort très important :
- Réécrire en React Native / Expo
- Remplacer toutes les deps Node.js par équivalents RN
- Gérer WebSocket différemment
- Pas de filesystem standard

**Estimation :** 3-6 mois de développement

#### Cas d'usage sur téléphone

| Use Case | Faisabilité | Notes |
|----------|-------------|-------|
| Recevoir DMs et notifier | Possible | Via Termux + notification |
| Envoyer SMS via SMS Gateway | Excellent | Même téléphone = latence minimale |
| Relayer vers Telegram | Possible | Requiert background stable |
| Contrôle GPIO | Impossible | Pas d'accès hardware |
| Dashboard monitoring | Possible | PWA locale |

#### Recommandation

**Pour usage réel :** Termux sur Android avec `termux-wake-lock`
- Idéal pour : SMS Gateway (même device), bridge messaging
- Éviter pour : Workloads 24/7 critiques, GPIO

**Pour production :** Raspberry Pi ou VPS reste préférable
- Stabilité, background garanti, GPIO possible

#### Tâches de recherche

- [ ] Tester PipeliNostr sur Termux (Android)
- [ ] Documenter les workarounds background
- [ ] Évaluer consommation batterie
- [ ] Tester combo SMS Gateway + PipeliNostr même device
- [ ] Explorer PWA dashboard option

---
