# PipeliNostr

> The n8n of Nostr — Route Nostr events to external services.

PipeliNostr is a self-hosted event router that listens to Nostr relays and forwards events to external services (Telegram, email, GPIO, Mastodon, Bluesky, and more) based on YAML workflow definitions.

## Features

- **Multi-source triggers**: Listen to Nostr DMs, zaps, notes, webhooks
- **18+ handlers**: Telegram, email, Zulip, Mastodon, Bluesky, GPIO, MongoDB, FTP, and more
- **YAML workflows**: No code needed — define routing rules in simple YAML
- **Hook chaining**: Sequential workflow composition (on_complete, on_fail, on_start)
- **Template engine**: Handlebars with 30+ built-in helpers (math, string, date, sats)
- **Persistent state**: Workflow-level storage for balances, counters, flags
- **Event queue**: SQLite-backed with retry logic and dead letter queue
- **Workflow auditor**: Static analysis catches errors before runtime
- **Security**: Secret redaction, HMAC validation, file-based secrets

## Quick Start

```bash
# Clone and install
git clone https://github.com/Tirodem/pipelinostr.git
cd pipelinostr
npm install

# Configure
cp config/config.yml.example config/config.yml
# Edit config/config.yml with your nostr private key and relay list

# Deploy workflow examples
./scripts/pipelinostr.sh workflow load-missing
./scripts/pipelinostr.sh workflow enable nostr-to-telegram

# Build and start
npm run build
npm start
```

## Configuration

Main config: `config/config.yml`

```yaml
nostr:
  private_key: env:NOSTR_PRIVATE_KEY
  relays:
    - wss://relay.damus.io
    - wss://nos.lol
  whitelist:
    - npub1...

database:
  path: data/pipelinostr.db

queue:
  enabled: true
  poll_interval_ms: 1000

webhook:
  enabled: false
  port: 3000
```

Secrets use explicit prefixes (no shell expansion):
- `env:VAR_NAME` — reads from environment / .env file
- `file:/path/to/secret` — reads from file (for systemd credentials)

## Workflows

Workflows are YAML files in `config/workflows/`. Examples in `workflows/`.

```yaml
# Forward DMs to Telegram
id: nostr-to-telegram
name: Forward DM to Telegram

trigger:
  source: nostr.dm
  from_whitelist: true

actions:
  - id: send
    type: telegram
    text: "DM from {{ trigger.sender }}: {{ trigger.content }}"
```

### Trigger sources

| Source | Description |
|--------|------------|
| `nostr.dm` | Nostr DMs (NIP-04 + NIP-17) |
| `nostr.zap` | Zap receipts |
| `nostr.note` | Text notes |
| `nostr.reaction` | Reactions |
| `nostr.raw` | Raw kind filter (escape hatch) |
| `webhook.post` | HTTP webhooks |
| `dm` | Any DM, any platform |

### Template variables

| Variable | Description |
|----------|------------|
| `trigger.sender` | Sender identifier |
| `trigger.content` | Message content |
| `trigger.source` | Source string (e.g. `nostr.dm`) |
| `trigger.dm_format` | `nip04` or `nip17` |
| `trigger.zap.amount` | Zap amount in sats |
| `match.groupName` | Regex capture group |
| `actions.id.success` | Action result boolean |
| `actions.id.response.*` | Action response data |
| `variables.name` | Workflow variable |
| `parent.variables.name` | Parent workflow variable |

## Handlers

| Handler | Type | Description |
|---------|------|------------|
| Telegram | `telegram` | Bot messages and voice files |
| Email | `email` | SMTP via nodemailer |
| Nostr DM | `nostr_dm` | Reply in NIP-04 or NIP-17 |
| Nostr Note | `nostr_note` | Publish kind 1 text notes |
| HTTP | `http` | REST API calls |
| Zulip | `zulip` | Stream and private messages |
| Mastodon | `mastodon` | Toot posting |
| Bluesky | `bluesky` | AT Protocol posts |
| GPIO | `gpio` | Raspberry Pi GPIO control |
| File | `file` | Local filesystem |
| FTP | `ftp` | FTP upload |
| MongoDB | `mongodb` | Document operations |
| Calendar | `calendar` | iCal invitations |
| SMS | `traccar_sms` | SMS via Traccar Gateway |
| Claude | `claude` | AI chat via Anthropic API |
| Odoo | `odoo` | ERP JSON-RPC operations |
| Workflow DB | `workflow_db` | Persistent state (balances, counters) |
| System | `system` | Status information |

## CLI

```bash
./scripts/pipelinostr.sh workflow list
./scripts/pipelinostr.sh workflow enable nostr-to-telegram
./scripts/pipelinostr.sh workflow disable all
./scripts/pipelinostr.sh workflow audit
./scripts/pipelinostr.sh handler list
./scripts/pipelinostr.sh queue replay <id>
./scripts/pipelinostr.sh db clean
```

## Architecture

See [docs/architecture/](docs/architecture/) for the full set of Architecture Decision Records (ADRs).

```
┌─────────────────────────────────────────────────────────┐
│                     PipeliNostr v2                        │
├─────────────────────────────────────────────────────────┤
│  INBOUND             CORE              OUTBOUND          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Nostr    │→ │ Normalized   │→ │ Handler      │      │
│  │ Listener │  │ Event        │  │ Registry     │      │
│  ├──────────┤  ├──────────────┤  │ (18 handlers)│      │
│  │ Webhook  │→ │ Workflow     │  └──────────────┘      │
│  │ Server   │  │ Engine       │                         │
│  └──────────┘  ├──────────────┤  ┌──────────────┐      │
│                │ Queue Worker │→ │ SQLite + WAL  │      │
│                │ (retry/DLQ)  │  │ (better-      │      │
│                └──────────────┘  │  sqlite3)     │      │
│                                  └──────────────┘      │
└─────────────────────────────────────────────────────────┘
```

## Deployment

PipeliNostr runs on:
- **Raspberry Pi / Orange Pi** — GPIO support for IoT/DIY
- **Old laptops, NUCs, VPS** — Heavier workloads
- **Any Linux machine** with Node.js LTS

```bash
# One-command deploy
./scripts/rebuild.sh

# Or as a service
sudo systemctl start pipelinostr
```

## License

MIT
