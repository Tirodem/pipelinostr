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
| `dm-to-ftp-with-local-storage.yml` | DM to local log file + FTP sync |
| `mempool-tx-lookup.yml` | Lookup Bitcoin TX and reply via DM |
| `zulip-workflow-notification.yml` | Notify Zulip on workflow completion |
| `api-to-nostr-dm.yml` | Forward HTTP API calls to Nostr DM |
| `pipelinostr-status.yml.example` | Get system status via /pipelinostr status DM |

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
| `default:value` | Default value if undefined |
| `json` | Convert to JSON string |
| `date` | Format Unix timestamp as ISO date |
| `date_short` | Format as YYYY-MM-DD HH:MM |
| `sats_to_btc` | Convert satoshis to BTC (8 decimals) |
| `number` | Format with thousand separators |
| `length` | Get array or string length |

Example: `{{ match.to | trim }}`

### Array Access

Access array elements using bracket notation:

```yaml
content: |
  First input: {{ actions.http.response.body.items[0].name }}
  Second output: {{ actions.http.response.body.outputs[1].value }}
  Total items: {{ actions.http.response.body.items | length }}
```

## Workflow Hooks (Chaining)

Workflows can trigger other workflows using lifecycle hooks:

```yaml
hooks:
  on_start:
    - workflow_id: parallel-task      # Runs in parallel when workflow starts
  on_complete:
    - workflow_id: notify-success     # Runs after successful completion
  on_fail:
    - workflow_id: notify-failure     # Runs after failure
```

### Hook Options

| Option | Description |
|--------|-------------|
| `workflow_id` | ID of the workflow to trigger (required) |
| `when` | Condition expression (optional) |
| `pass_context` | Pass parent context to child (default: true) |

### Parent Context (`parent.*`)

Child workflows triggered by hooks have access to parent info:

| Variable | Description |
|----------|-------------|
| `parent.id` | Parent workflow ID |
| `parent.name` | Parent workflow name |
| `parent.success` | true/false |
| `parent.actionsExecuted` | Number of successful actions |
| `parent.actionsFailed` | Number of failed actions |
| `parent.actionsSkipped` | Number of skipped actions |
| `parent.error` | Error message (if failed) |

### Example: Workflow with notifications

```yaml
id: my-workflow
name: My Workflow
enabled: true

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    content_pattern: "^test"

actions:
  - id: do_something
    type: http
    config:
      url: "https://api.example.com"

hooks:
  on_complete:
    - workflow_id: zulip-workflow-notification
  on_fail:
    - workflow_id: zulip-workflow-notification
```
