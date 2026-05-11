---
title: Common workflows
description: Practical patterns for using LiteAI effectively — plan mode, code review, debugging, refactoring, and more.
---

# Common workflows

This page covers the most common patterns for working with LiteAI. These workflows apply across all platforms (CLI, Web UI, VS Code).

## Plan then build

The most effective workflow for complex changes:

1. **Switch to Plan mode** — Use `/mode plan` or the prompt tray toggle
2. **Describe what you want** — Give LiteAI context about the change
3. **Iterate on the plan** — Ask follow-up questions, refine the approach
4. **Switch to Build mode** — Use `/mode build`
5. **Execute** — Tell the agent to implement the plan

```
/mode plan
> I need to add authentication to the /settings route. Look at how it's
> handled in /notes and propose a plan.

[Agent provides plan without modifying files]

/mode build
> Looks good. Go ahead and implement the plan.

[Agent makes the changes]
```

:::tip
Plan mode is especially valuable for large architectural changes where you want to review the approach before any code is modified.
:::

## Code review

Ask LiteAI to review code without making changes:

```
> Review the changes in src/auth/service.ts for security issues,
> edge cases, and code style problems. Don't make changes — just
> report your findings.
```

For git-based review:

```
> Review the diff from the last 3 commits. Focus on logic errors
> and potential regressions.
```

## Debugging

LiteAI excels at systematic debugging:

```
> The tests in test/session/ are failing with "TypeError: Cannot
> read property 'id' of undefined". Debug this — read the test
> file, trace the execution path, identify the root cause, and
> fix it.
```

The agent will:
1. Read the failing test
2. Read the source code being tested
3. Identify the null reference
4. Apply a fix
5. Run the test to verify

## Refactoring

For safe refactoring, combine plan mode with checkpointing:

```
> Refactor the permission service to use the Strategy pattern
> instead of the current switch statement. Make sure all
> existing tests still pass.
```

If the result isn't what you expected, use `/undo` to revert all changes.

## Exploring a new codebase

When working with unfamiliar code:

```
> I'm new to this codebase. Give me a high-level overview of the
> architecture — what are the main modules, how do they interact,
> and where does the request flow start?
```

Follow up with specific questions:

```
> How is authentication handled? Trace the flow from the HTTP
> request to the database query.
```

## Multi-file changes with coordinator mode

For changes that span many files, use coordinator mode:

```
/mode coordinator
> We need to rename the "permission" module to "authorization"
> across the entire codebase. This includes:
> - File renames
> - Import updates
> - Type name changes
> - Test updates
> - Documentation updates
```

The coordinator will spawn specialized worker agents to handle each area in parallel.

## Test-driven development

```
> Write a test for the new `validateConfig` function that covers:
> 1. Valid config with all required fields
> 2. Missing required fields
> 3. Invalid field types
> 4. Extra unknown fields
>
> Then implement the function to make all tests pass.
```

## Commit workflows

```
> Review all uncommitted changes, write a conventional commit
> message, and stage the relevant files. Don't include unrelated
> changes.
```

## Using subagents

For parallel work:

```
> I need two things done:
> 1. Add input validation to all API routes
> 2. Write unit tests for the config loader
>
> Use separate agents for each task.
```

LiteAI will fork two subagents that work concurrently, each with its own context window.

## What's next?

- [**Best practices**](/getting-started/best-practices) — Tips for effective prompt engineering
- [**Permission modes**](/getting-started/permission-modes) — Control what the agent can do
- [**Run agent teams**](/build/agent-teams) — Coordinator mode details
