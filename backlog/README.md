# PipeliNostr Backlog

Feature backlog organized by status.

## Structure

```
backlog/
├── to-do/      # Proposed, Pending, Research
├── wip/        # In Progress
├── to-test/    # Testing, Ready for QA
└── done/       # Done, Cancelled, Deprecated
```

## File Naming Convention

Files are named with date prefix for chronological ordering:

```
YYYY-MM-DD-feature-name.md
```

## File Format

Each feature file has YAML frontmatter:

```yaml
---
title: "Feature Name"
priority: "High|Medium|Low|Very Low"
status: "Proposed|WIP|Testing|DONE|CANCELLED"
created: "YYYY-MM-DD"
completed: "YYYY-MM-DD"  # Only for done items
---

### Feature Name

**Priority:** Medium
**Status:** Proposed

#### Description
...
```

## Workflow

1. New idea → Create file in `to-do/` with today's date
2. Start working → Move to `wip/`
3. Ready to test → Move to `to-test/`
4. Completed → Move to `done/`, update frontmatter with `completed` date

## Scripts

- `scripts/split-backlog-to-files.cjs` - Split legacy BACKLOG.md into individual files
