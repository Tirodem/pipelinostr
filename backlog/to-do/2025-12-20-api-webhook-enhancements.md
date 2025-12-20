---
title: "API Webhook Enhancements"
priority: "Medium"
status: "Proposed"
created: "2025-12-20"
---

### API Webhook Enhancements

**Priority:** Medium
**Status:** Proposed

#### Description

Enhance the webhook server with workflow-bound routes and authentication.

#### Features

**1. Workflow-Bound Routes**

Define routes directly in workflows instead of central webhook config:

```yaml
# Workflow defines its own API route
id: store-to-ftp
name: API to FTP Storage
enabled: true

trigger:
  type: http_webhook
  config:
    path: "/api/store"
    methods: ["POST"]
    # Route only exists when workflow is enabled

actions:
  - id: write_ftp
    type: ftp
    config:
      path: "/data/{{ trigger.timestamp }}.json"
      content: "{{ trigger.content }}"
```

Benefits:
- Routes auto-created when workflow enabled
- Routes auto-removed when workflow disabled
- Self-documenting API (workflow = route)
- Unknown routes return `200 Not Found` (or 404)

**2. API Authentication**

Protect API endpoints with credentials:

```yaml
# config/handlers/webhook.yml
webhook:
  enabled: true
  port: 3000

  auth:
    enabled: true
    methods:
      - type: api_key
        header: "X-API-Key"
        keys:
          - ${API_KEY_1}
          - ${API_KEY_2}
      - type: bearer
        secret: ${JWT_SECRET}

  webhooks:
    - id: "notify"
      path: "/api/notify"
      auth: true  # Requires auth
    - id: "public"
      path: "/api/public"
      auth: false  # No auth required
```

**3. Route Discovery Endpoint**

```
GET /api/routes
```

Returns list of available routes with their associated workflows.

#### Implementation Notes

- Current webhook server already supports `secret` per webhook
- Need to add global auth middleware
- Workflow-bound routes require workflow loader to register routes dynamically

---


---
