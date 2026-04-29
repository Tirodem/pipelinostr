# PipeliNostr

> The n8n of Nostr — Route Nostr events to external services.

**Status: WIP (v2 branch) — Not for production use.**

## What is PipeliNostr?

PipeliNostr is a self-hosted Nostr event router. It listens to Nostr relays, matches incoming events against workflow rules, and executes actions: send emails, forward to Telegram, query AI, post to Zulip, and more.

## How it works

- **Inbound sources** (Nostr DMs, zaps, webhooks) produce normalized events
- **Workflows** define trigger rules + action chains in YAML
- **Handlers** connect to external services (Telegram, email, Claude AI, etc.)
- **Queue** ensures reliable delivery with retry and dead-letter

Handlers are configured once (API keys, credentials via `.env`). Workflows use handlers to build automation chains. One handler can serve many workflows.

## Prerequisites

- Linux VPS (Debian/Ubuntu recommended)
- Node.js 20+ LTS
- A Nostr private key (nsec)

## Install

```bash
curl -sL https://raw.githubusercontent.com/Tirodem/the-ultra-secret-wip-side-project-we-dont-want-to-talk-about/v2/scripts/install.sh | sudo bash
```

The setup wizard guides you through:
1. Nostr key + relay configuration
2. Handler selection + credentials
3. Workflow selection
4. Systemd service setup

After install, manage PipeliNostr with:

```bash
sudo /opt/pipelinostr/scripts/setup-wizard.sh
```

Features: update, edit handlers/workflows/credentials, monitor logs/relays/queue, handler/workflow consistency check.

## Validated Handlers

| Handler | Description | .env variables |
|---------|-------------|----------------|
| calendar | Send calendar invites via SMTP | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` |
| claude | AI chat via Anthropic API | `ANTHROPIC_API_KEY` |
| email | Send emails via SMTP | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` |
| nostr_dm | Send Nostr DMs | (auto-configured) |
| system | Internal system commands | (auto-configured) |
| telegram | Send messages/voice to Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| tts | Text-to-speech (espeak-ng) | (auto-configured, installs espeak-ng) |
| usb_power | USB power control for dispensers | (auto-configured, requires hardware) |
| zulip | Post to Zulip streams | `ZULIP_SITE_URL`, `ZULIP_EMAIL`, `ZULIP_API_KEY` |

## Validated Workflows

### auto-reply

Auto-reply to greetings.

- **DM syntax:** `hello` / `bonjour` / `salut` / `hi` / `hey`
- **Handlers:** nostr_dm
- **.env:** —

### nostr-to-claude

Ask Claude AI a question via DM.

- **DM syntax:** `claude: <your question>`
- **Handlers:** claude, nostr_dm
- **.env:** `ANTHROPIC_API_KEY`

### nostr-to-telegram

Forward a DM to Telegram.

- **DM syntax:** `tg: <message>`
- **Handlers:** telegram
- **.env:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

### dm-to-voice-telegram

Convert text to audio and send as Telegram voice message.

- **DM syntax:** `Send vocal to TG: <message>`
- **Handlers:** tts, telegram, nostr_dm
- **.env:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

### nostr-to-email

Send an email from a DM.

- **DM syntax:** `Send email to <address>: <message>`
- **Handlers:** email
- **.env:** `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`

### nostr-to-calendar

Send a calendar invite from a DM.

- **DM syntax:** `Invite <email>: <title> @ YYYY-MM-DD HH:MM (<duration>) @ <location>`
- **Example:** `Invite bob@mail.com: Meeting @ 2026-04-10 14:00 (1h) @ Paris`
- **Handlers:** calendar
- **.env:** `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`

### zulip-forward

Forward a DM to a Zulip stream.

- **DM syntax:** `zulip: <message>`
- **Handlers:** zulip
- **.env:** `ZULIP_SITE_URL`, `ZULIP_EMAIL`, `ZULIP_API_KEY`

### pipelinostr-help

Show available commands.

- **DM syntax:** `/help` or `/pipelinostr help`
- **Handlers:** nostr_dm
- **.env:** —

### pipelinostr-status

Show system status.

- **DM syntax:** `/pipelinostr status`
- **Handlers:** system, nostr_dm
- **.env:** —

### api-to-nostr-dm

Forward webhook POST to a Nostr DM.

- **Trigger:** `POST /api/notify` with JSON body and HMAC signature
- **Handlers:** nostr_dm
- **.env:** —
- **Note:** Edit deployed workflow to set recipient npub

### api-to-zulip-public

Forward webhook POST to a Zulip stream.

- **Trigger:** `POST /api/zulip-notify` with JSON body and HMAC signature
- **Handlers:** zulip
- **.env:** `ZULIP_SITE_URL`, `ZULIP_EMAIL`, `ZULIP_API_KEY`

### zulip-workflow-ok

Hook: notify Zulip when a workflow completes.

- **Trigger:** Used as `on_complete` hook in other workflows
- **Handlers:** zulip
- **.env:** `ZULIP_SITE_URL`, `ZULIP_EMAIL`, `ZULIP_API_KEY`

### zap-to-usb-dispenser

Trigger USB dispenser on zap receipt.

- **Trigger:** Incoming zap above threshold
- **Handlers:** nostr_dm, usb_power
- **.env:** —
- **Note:** Requires USB hardware
