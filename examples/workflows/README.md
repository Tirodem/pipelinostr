# Example Workflows

This directory contains example workflow configurations for PipeliNostr.

## Usage

Copy any workflow to `config/workflows/` and customize as needed:

```bash
cp examples/workflows/zulip-forward.yml config/workflows/
```

Then restart PipeliNostr to load the new workflow.

## Available Examples

| File | Description |
|------|-------------|
| `zulip-forward.yml` | Forward all Nostr DMs to a Zulip stream |
| `nostr-to-email.yml` | Send emails via Nostr DM command |
| `nostr-to-telegram.yml` | Forward Nostr DMs to Telegram |
| `nostr-to-calendar.yml` | Create calendar events via Nostr DM |
| `nostr-to-sms.yml` | Send SMS via Nostr DM |
| `zap-notification.yml` | Get notified when receiving zaps |
| `dm-to-mastodon.yml` | Post to Mastodon via Nostr DM |
| `dm-to-bluesky.yml` | Post to Bluesky via Nostr DM |
| `dm-to-mongodb.yml` | Track events to MongoDB via Nostr DM |
| `dm-to-ftp.yml` | Append DM content to FTP log file |

## Template Variables

### Trigger Context (`trigger.*`)

| Variable | Description |
|----------|-------------|
| `trigger.from` | Sender's npub |
| `trigger.pubkey` | Sender's hex pubkey |
| `trigger.content` | Decrypted message content |
| `trigger.kind` | Event kind (4 for DMs) |
| `trigger.timestamp` | Unix timestamp |
| `trigger.relayUrl` | Relay URL where event was received |

### Match Groups (`match.*`)

When using `content_pattern` with named capture groups:

```yaml
content_pattern: "^command (?<arg1>\\w+) (?<arg2>\\w+)"
```

Access captured values with `{{ match.arg1 }}`, `{{ match.arg2 }}`, etc.

### Filters

| Filter | Description |
|--------|-------------|
| `trim` | Remove leading/trailing whitespace |
| `lower` | Convert to lowercase |
| `upper` | Convert to uppercase |
| `truncate:N` | Truncate to N characters |

Example: `{{ match.to | trim }}`
