# Task Manager Workflow

A command-driven task list accessible over Nostr DMs.  
No code changes required — built entirely on existing PipeliNostr YAML workflows and handlers.

---

## What it does

Lets you manage a simple personal task list by sending DM commands to your PipeliNostr bot.  
Tasks are persisted in the local SQLite database using the `workflow_db` handler.

---

## Supported Commands

| Command | Description |
|---|---|
| `/add <title>` | Add a new task |
| `/tasks` | List all tasks with their status |
| `/done <number>` | Mark task #N as done |
| `/clear` | Reset the task counter |
| `/help tasks` | Show the command reference |

### Examples

```
/add Buy groceries
→ ✅ Task #1 added: Buy groceries

/add Review pull request
→ ✅ Task #2 added: Review pull request

/tasks
→ 📋 Your tasks (2):
  #1 — Buy groceries [pending]
  #2 — Review pull request [pending]

/done 1
→ ✅ Task #1 marked as done.

/tasks
→ 📋 Your tasks (2):
  #1 — [done]
  #2 — Review pull request [pending]

/clear
→ 🗑️ Task counter reset. New tasks will start from #1.
```

---

## Required Configuration

### Whitelist

The workflow uses `from_whitelist: true`. Your npub must be in the whitelist, **or** you must set `whitelist.enabled: false` in `config/config.yml`.

```yaml
# config/config.yml
whitelist:
  enabled: true
  npubs:
    - "npub1yourkey..."
```

### No external services required

Tasks are stored locally in SQLite via `workflow_db`. No APIs, no tokens, no extra setup.

---

## How it fits the existing system

| Layer | Role |
|---|---|
| `trigger` | Matches `/tasks`, `/add`, `/done`, `/clear`, `/help tasks` via regex |
| `workflow_db` | Reads/writes task data to SQLite using `namespace: tasks` |
| `nostr_dm` | Sends replies back to the sender |
| `when` conditions | Each action only fires for its matching command |

The counter pattern (`task_1`, `task_2`, ...) is a simple key scheme that avoids needing a real database query for individual lookups.

---

## Limitations

- **`/clear` does not delete individual task keys** — it resets the counter to 0. Old task keys remain in the DB as orphaned rows but are ignored on listing. This is a limitation of the `workflow_db` handler not supporting bulk deletes via YAML.
- **No priorities or due dates** — the current `workflow_db` `set` action stores a single string value. Structured fields (priority, date) would require JSON storage and a custom formatter.
- **`/tasks` lists all keys matching `task_%`** — if counter is reset with `/clear`, old tasks may reappear. A future improvement would be a `delete_pattern` action in `workflow_db`.
- **No multi-user isolation** — all tasks are stored under the same `workflow_id`. If multiple npubs use the bot, they share the same list. To isolate per-user, the `namespace` would need to include `trigger.pubkey`.

---

## File location

```
config/workflows/task-manager.yml
```

## Architecture decision

**Pure YAML + existing handlers** was chosen over adding TypeScript because:

1. `workflow_db` already supports `get`, `set`, `increment`, `list` — enough for a basic task list
2. Adding a dedicated handler would break the declarative philosophy of PipeliNostr
3. The YAML approach keeps the feature understandable and modifiable without touching source code
4. It demonstrates the real power of the workflow engine: chained actions, conditional execution, and persistent state — all in config
