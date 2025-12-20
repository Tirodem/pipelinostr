# ClaudeDM - Claude as a Service via Nostr DMs

## Overview

ClaudeDM is a paid Claude API service accessible via Nostr DMs. Users pay with Lightning zaps to accumulate SATs credits, then spend those credits to interact with Claude.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ClaudeDM System                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐      ┌──────────────┐      ┌─────────────┐            │
│  │ Zap Receipt │      │ workflow_db  │      │ Claude API  │            │
│  │ (kind 9735) │─────►│ (balances)   │◄────►│             │            │
│  └─────────────┘      └──────────────┘      └─────────────┘            │
│         │                    ▲                     │                     │
│         │                    │                     │                     │
│         ▼                    │                     ▼                     │
│  ┌─────────────┐      ┌──────────────┐      ┌─────────────┐            │
│  │ zap-balance │      │ claudeDM     │      │ Nostr DM    │            │
│  │ -tracker    │      │ -entry       │─────►│ Response    │            │
│  └─────────────┘      └──────────────┘      └─────────────┘            │
│                              │                                           │
│                              │ on_fail                                   │
│                              ▼                                           │
│                       ┌──────────────┐                                  │
│                       │ Error        │                                  │
│                       │ Workflows    │                                  │
│                       └──────────────┘                                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Workflows

### 1. zap-balance-tracker.yml

**Purpose:** Track incoming zaps and accumulate SATs balance per sender npub.

**Trigger:** kind 9735 (zap receipts)

**Flow:**
1. Receive zap receipt
2. Extract sender npub and amount
3. Increment sender's balance in workflow_db
4. Optionally notify sender of credit

**State stored:**
- Key: `balance:<npub>`
- Namespace: `balances`
- Value: cumulative SATs

### 2. claudeDM-entry.yml

**Purpose:** Entry point for Claude requests via DM.

**Trigger:** DM matching `/claudeDM <question>`

**Flow:**
1. Check sender's balance >= minimum (40 SATs default)
2. Validate request length and content
3. Send to Claude API
4. Calculate cost (based on tokens used)
5. Debit sender's balance
6. Reply with response + cost info

**On failure:** Triggers error workflows

### 3. claudeDM-insufficient-balance.yml

**Purpose:** Handle insufficient balance errors.

**Trigger:** on_fail hook from claudeDM-entry (balance check failed)

**Response:** Informs user of current balance and how to top up.

### 4. claudeDM-error-response.yml

**Purpose:** Handle Claude API errors.

**Trigger:** on_fail hook from claudeDM-entry (Claude request failed)

**Response:** Informs user of error, confirms no debit was made.

## Configuration

### zap-balance-tracker

```yaml
trigger:
  filters:
    zap_min_amount: 1       # Minimum zap amount to track
    zap_recipients:          # Optional: only track zaps to these npubs
      - "npub1..."
```

### claudeDM-entry

```yaml
variables:
  min_balance_sats: 40      # Minimum balance to use service
  max_request_length: 4000  # Max characters per request
  sats_per_1k_tokens: 10    # Cost calculation
  forbidden_words:          # Blocked words
    - "word1"
    - "word2"
```

## Handler: workflow_db

System handler (always enabled) for persistent state management.

### Actions

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `get` | Read a value | `key` |
| `set` | Write a value | `key`, `value` |
| `increment` | Increase number | `key`, `amount` |
| `decrement` | Decrease number | `key`, `amount` |
| `delete` | Remove a value | `key` |
| `list` | List values | `key_pattern` (optional) |
| `check` | Compare values | `key`, `operator`, `compare_value` |

### Check Operators

- `eq`, `ne` - Equal, Not equal
- `gt`, `gte` - Greater than, Greater or equal
- `lt`, `lte` - Less than, Less or equal
- `exists`, `not_exists` - Key existence check

### Example Usage

```yaml
# Increment balance
- id: add_credits
  type: workflow_db
  config:
    action: increment
    namespace: balances
    key: "balance:{{ trigger.zap.sender }}"
    amount: "{{ trigger.zap.amount }}"
    track_history: true

# Check balance
- id: check_balance
  type: workflow_db
  config:
    action: check
    workflow_id: zap-balance-tracker
    namespace: balances
    key: "balance:{{ trigger.author_npub }}"
    operator: gte
    compare_value: 40
  on_fail:
    workflow: insufficient-balance
```

## Setup

1. Copy example workflows to `config/workflows/`:
   ```bash
   cp examples/workflows/zap-balance-tracker.yml.example config/workflows/zap-balance-tracker.yml
   cp examples/workflows/claudeDM-*.yml.example config/workflows/
   ```

2. Configure `zap_recipients` in zap-balance-tracker if needed

3. Configure Claude API key in `config/handlers/claude.yml`:
   ```yaml
   claude:
     enabled: true
     api_key: "sk-ant-..."
   ```

4. Enable workflows:
   ```yaml
   # In each workflow file
   enabled: true
   ```

5. Restart PipeliNostr

## Cost Calculation

Default formula: `tokens_used * sats_per_1k_tokens / 1000`

With default settings (10 SATs/1k tokens):
- 100 tokens = 1 SAT
- 1000 tokens = 10 SATs
- 10000 tokens = 100 SATs

## Future Improvements

- [ ] Automatic price conversion via Coinbase API
- [ ] Rate limiting per user
- [ ] Request validation (length, forbidden words)
- [ ] Usage statistics and reporting
- [ ] Refund mechanism for failed requests
