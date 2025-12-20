---
title: "Meta-Workflows (Workflow Orchestration)"
priority: "Medium"
status: "DONE"
created: "2025-12-20"
completed: "2025-12-20"
---

### Meta-Workflows (Workflow Orchestration)

**Priority:** Medium
**Status:** DONE

#### Description

Implement meta-workflows that can orchestrate multiple workflows as steps, with parallel or sequential execution.

#### Use Case

Complex automation scenarios like:
- Send notification to Slack AND Telegram simultaneously (parallel)
- Create GitHub issue, then post link to Discord (sequential)
- Fan-out: notify multiple channels from a single DM
- Conditional branching based on previous step results

#### Proposed Syntax

```yaml
id: multi-notify
name: Multi-Channel Notification
enabled: true
type: meta  # New workflow type

trigger:
  type: nostr_event
  filters:
    kinds: [4]
    from_whitelist: true
    content_pattern: "^\\[broadcast\\]\\s*(?<message>.+)"

steps:
  # Parallel execution
  - parallel:
      - workflow: slack-forward
        params:
          message: "{{ match.message }}"
      - workflow: telegram-forward
        params:
          message: "{{ match.message }}"
      - workflow: discord-forward
        params:
          message: "{{ match.message }}"

  # Sequential execution
  - sequence:
      - workflow: github-create-issue
        id: issue
        params:
          title: "From Nostr: {{ match.message | truncate:50 }}"
      - workflow: slack-notify
        params:
          message: "Issue created: {{ steps.issue.result.url }}"
        when: "{{ steps.issue.success }}"
```

#### Implementation Notes

- New `type: meta` for orchestration workflows
- `parallel:` block executes all workflows concurrently
- `sequence:` block executes workflows in order
- Access previous step results via `steps.<id>.result`
- Conditional execution with `when:`

---


---
