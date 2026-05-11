---
title: Run prompts on a schedule
description: "Use LiteAI's scheduler to run prompts automatically at specified intervals."
---

# Run prompts on a schedule

LiteAI includes a scheduler service for running prompts at specified intervals.

## Configuration

```json
// settings.json
{
  "scheduler": {
    "jobs": [
      {
        "name": "daily-review",
        "cron": "0 9 * * *",
        "prompt": "Review any uncommitted changes and summarize what's in progress.",
        "model": "claude-sonnet-4-20250514"
      }
    ]
  }
}
```

## Cron syntax

Standard 5-field cron expressions:

| Field | Values |
|---|---|
| Minute | 0-59 |
| Hour | 0-23 |
| Day of month | 1-31 |
| Month | 1-12 |
| Day of week | 0-7 (0 and 7 = Sunday) |

## Background execution

Scheduled prompts run in headless sessions with bypass permissions. Results are stored in the session history and can be reviewed later.

## What's next?

- [**Programmatic usage**](/build/programmatic-usage) — SDK and headless mode
- [**Automate with hooks**](/build/hooks) — Event-driven automation
