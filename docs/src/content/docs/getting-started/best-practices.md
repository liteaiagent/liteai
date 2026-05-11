---
title: Best practices
description: Tips and strategies for getting the most out of LiteAI — prompting, AGENTS.md, mode selection, and performance.
---

# Best practices

These recommendations come from real-world usage patterns. They apply to all experience levels.

## Prompting

### Be specific about what you want

**Less effective:**
```
Fix the bug in auth.
```

**More effective:**
```
The login function in src/auth/service.ts throws a null reference
error when the user doesn't have a session token. Read the function,
identify the missing null check, and add it. Run the auth tests after.
```

### Provide context and constraints

```
Refactor the `processOrder` function to use async/await instead of
callbacks. Keep the same public interface — don't change the function
signature or return type. The tests in test/orders.test.ts should
still pass without modification.
```

### Reference files with paths

LiteAI works best when you point it to specific files:

```
Look at the pattern used in src/auth/middleware.ts and apply the
same CSRF protection to src/api/routes/webhook.ts.
```

### Break complex tasks into steps

Instead of one massive prompt, work iteratively:

```
Step 1: "Explain how the session engine processes a tool call."
Step 2: "Now add logging at each stage of that pipeline."
Step 3: "Write a test that verifies the logs are emitted correctly."
```

## AGENTS.md

### Keep it focused

Your AGENTS.md should contain **rules**, not **tutorials**. Every token reduces context window space.

**Good:**
```markdown
- Use `bun` for all package management
- Run `bun typecheck` after modifications
- Never auto-delete unused variables — analyze if they should be used first
```

**Avoid:**
```markdown
Here's a comprehensive guide to our codebase architecture...
[500 lines of background information]
```

### Use subdirectory instructions

Instead of one massive root AGENTS.md, split rules by directory:

```
project/
├── AGENTS.md                  # General project rules
├── src/
│   └── AGENTS.md              # Source code conventions
├── test/
│   └── AGENTS.md              # Testing conventions
└── docs/
    └── AGENTS.md              # Documentation style guide
```

Subdirectory instructions are loaded **on demand** when the agent accesses files in that directory, keeping the base context lean.

### Commit AGENTS.md to git

Your AGENTS.md is project knowledge that benefits the entire team. Commit it alongside your code.

## Mode selection

| Situation | Recommended mode |
|---|---|
| Writing new features | Build |
| Reviewing a PR | Plan |
| Exploring unfamiliar code | Plan |
| Multi-file refactoring | Coordinator |
| CI/CD automation | Build + bypass permissions |
| Security-sensitive changes | Build + default permissions |

## Performance

### Manage the context window

- Shorter AGENTS.md files leave more room for conversation
- Use Plan mode for exploration (no tool results consuming tokens)
- Fork subagents for parallel tasks (each gets its own context window)
- Let auto-compaction handle long sessions

### Use the right model for the task

| Task type | Model recommendation |
|---|---|
| Complex reasoning, architecture | Largest available (claude-sonnet, gpt-4) |
| Simple edits, formatting | Smaller/faster models |
| Code review (read-only) | Medium-size models |
| Coordinator workers | Workers can use smaller models |

### Leverage fork subagents

Fork subagents share the parent's prompt cache, making them ~70% cheaper than independent sessions for the same context. Use them for:

- Parallel file modifications
- Background research while you continue the main conversation
- Post-turn tasks (summarization, memory extraction)

## Security

- **Review before approving** — In default permission mode, read the tool action before clicking "Allow"
- **Use plan mode for untrusted code** — When exploring unfamiliar repositories
- **Enable worktree isolation** — For risky operations, use `LITEAI_ISOLATION=worktree` to work in a separate git worktree
- **Audit memory files** — Periodically review `~/.liteai/memory/` for unexpected content

## What's next?

- [**Common workflows**](/getting-started/common-workflows) — Practical patterns for daily use
- [**Create custom subagents**](/build/custom-subagents) — Build specialized agents
- [**Settings reference**](/configuration/settings) — Full configuration options
