---
title: "Web Dashboard for Job Monitoring"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
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


---
