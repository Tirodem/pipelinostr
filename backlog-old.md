# PipeliNostr Backlog - Archives

> Fonctionnalités terminées ou annulées.

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


---

### Claude API Status via DM Nostr

**Priority:** Low
**Status:** CANCELLED

#### Description

Ajouter un workflow permettant de consulter sa consommation de tokens Claude API via un DM Nostr avec la commande `/claude status`.

**ANNULÉ** : L'API Anthropic ne fournit pas d'endpoint pour consulter l'usage/quota. Ces informations sont uniquement disponibles sur https://console.anthropic.com/settings/usage.

---


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


---
