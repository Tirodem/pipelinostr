# Workflows Directory

This directory contains your active workflows.

## Getting Started

Copy example workflows from `examples/workflows/` and customize them:

```bash
# List available examples
ls examples/workflows/

# Copy a workflow
cp examples/workflows/nostr-to-gpio.yml config/workflows/

# Edit to customize
nano config/workflows/nostr-to-gpio.yml
```

## Important

- Only `.yml` files in this directory are loaded
- `.yml.example` files are ignored (templates for reference)
- Set `enabled: true` to activate a workflow
- Restart PipeliNostr after changes: `./scripts/restart.sh`

## Available Workflows (28)

### GPIO & Hardware
| Workflow | Description | Command |
|----------|-------------|---------|
| `nostr-to-gpio.yml` | Control GPIO LEDs/servo | `gpio:green`, `gpio:red`, `gpio:servo` |
| `zap-to-dispenser.yml` | Trigger servo on zap | Zap >= 21 sats |
| `nostr-to-morse.yml` | Play Morse code on buzzer | `morse: <text>` |

### Communication Nostr
| Workflow | Description | Command |
|----------|-------------|---------|
| `publish-note.yml` | Publish public note | `/publish <content>` |
| `auto-reply.yml` | Auto-respond to greetings | `hello`, `bonjour`, etc. |
| `command-handler.yml` | Slash commands | `/ping`, `/help`, `/status`, `/echo` |

### Messaging & Social
| Workflow | Description | Command |
|----------|-------------|---------|
| `dm-to-voice-telegram.yml` | Voice message to Telegram | `Send vocal to TG: <msg>` |
| `nostr-to-telegram.yml` | Forward DMs to Telegram | All DMs |
| `morse-to-telegram.yml` | Morse audio to Telegram (no hardware) | `morse:tg: <text>` |
| `dm-to-bluesky.yml` | Post to Bluesky | `Bluesky: <msg>` |
| `dm-to-mastodon.yml` | Post to Mastodon | `Mastodon: <msg>` |
| `nostr-to-sms.yml` | Send SMS | `Send SMS to +33...: <msg>` |
| `nostr-to-email.yml` | Send email | `Send email to x@y.com: <msg>` |
| `email-forward.yml` | Forward all DMs to email | All DMs |

### Zulip Integration
| Workflow | Description | Command |
|----------|-------------|---------|
| `zulip-forward.yml` | Forward DMs to Zulip | All DMs |
| `zap-notification.yml` | Notify zaps on Zulip | All zaps |
| `zulip-workflow-notification.yml` | Workflow status to Zulip | Via hooks |

### Storage & Archiving
| Workflow | Description | Command |
|----------|-------------|---------|
| `dm-to-ftp.yml` | Archive to FTP | `ftp: <msg>` |
| `dm-to-ftp-with-local-storage.yml` | Archive local + FTP | `ftp: <msg>` |
| `dm-to-mongodb.yml` | Log to MongoDB | `mongo: <data>` |

### APIs & Webhooks
| Workflow | Description | Command |
|----------|-------------|---------|
| `api-to-nostr-dm.yml` | HTTP API to DM | POST `/api/notify` |
| `webhook-notifier.yml` | Forward DMs to webhook | All DMs |
| `mempool-tx-lookup.yml` | Bitcoin TX lookup | `mempool: <txid>` |

### Calendar & ERP
| Workflow | Description | Command |
|----------|-------------|---------|
| `nostr-to-calendar.yml` | Send calendar invite | `Invite x@y.com: Title @ date (dur)` |
| `bebop-order-sync.yml` | Sync be-BOP to Odoo | `Payment for order #...` |

### System & Administration
| Workflow | Description | Command |
|----------|-------------|---------|
| `dpo-command.yml` | Generate GDPR/DPO report | `/dpo` |
| `claude-workflow-generator.yml` | Generate workflows via Claude AI | `/workflow <desc>` |
| `claude-activate.yml` | Activate/cancel pending workflows | `/activate`, `/cancel`, `/pending` |

## Full Documentation

See `docs/WORKFLOW-CATALOG.md` for detailed documentation of each workflow.
