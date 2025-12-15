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

## Example Workflows

| Workflow | Description |
|----------|-------------|
| `nostr-to-gpio.yml` | Control GPIO LEDs/servo via DM |
| `zap-to-dispenser.yml` | Trigger servo on Lightning zap |
| `zap-notification.yml` | Notify on incoming zaps |
| `dm-to-ftp.yml` | Log DMs to FTP server |
| `dm-to-voice-telegram.yml` | Convert DM to audio, send via Telegram |
| `auto-reply.yml` | Auto-respond to keywords |
| `email-forward.yml` | Forward DMs to email |

See `examples/workflows/` for the full list.
