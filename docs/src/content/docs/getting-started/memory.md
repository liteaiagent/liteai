---
title: Store instructions and memories
description: How to use AGENTS.md files and the memory system to give LiteAI persistent context about your project.
---

# Store instructions and memories

LiteAI has two mechanisms for persistent context: **instructions** (human-authored, read-only for the agent) and **memory** (agent-authored, persisted across sessions).

## Instructions (AGENTS.md)

### What they are

AGENTS.md files are markdown documents that you write and commit to your repository. Their content is injected into the agent's system prompt at the start of every turn.

### Resolution chain

LiteAI loads instructions using a hierarchical chain:

```mermaid
flowchart LR
    G["Global<br/>~/.liteai/AGENTS.md"] --> P["Project root<br/>AGENTS.md"]
    P --> S["Subdirectory<br/>src/AGENTS.md"]
    S --> U["URL<br/>Remote instructions"]
    
    style G fill:#1e293b,stroke:#334155
    style P fill:#1e293b,stroke:#334155
    style S fill:#1e293b,stroke:#334155
    style U fill:#1e293b,stroke:#334155
```

1. **Global** — `~/.liteai/AGENTS.md` — Applied to all projects
2. **Project** — `AGENTS.md` at your project root — Applied to this project
3. **Subdirectory (JIT)** — `src/AGENTS.md`, `tests/AGENTS.md` — Loaded when the agent accesses files in that directory
4. **URL** — Remote instructions fetched via HTTP (configured in settings.json)
5. **Custom paths** — Additional instruction files specified in `config.instructions`

All discovered files are concatenated and injected into the system prompt. Duplicate content is automatically deduplicated.

### Writing effective instructions

```markdown
# Project Rules

## Code style
- Use TypeScript strict mode with no `any` types
- Prefer functional patterns over class inheritance
- All public functions must have JSDoc comments

## Testing
- Run `bun test` after modifying source files
- Write tests before implementing features (TDD)
- Use `describe`/`it` blocks with descriptive names

## Architecture
- This is a monorepo managed with bun workspaces
- The `packages/core` directory contains the main engine
- Do not modify files in `vendor/` or `generated/`
```

:::tip
Keep your AGENTS.md focused and concise. Every token in the instruction file reduces the space available for conversation history.
:::

### Platform profiles

LiteAI supports loading instructions from other AI coding tool conventions:

| Platform | Instruction file | Enable with |
|---|---|---|
| LiteAI (default) | `AGENTS.md` | Default |
| Claude Code | `CLAUDE.md` | `LITEAI_PLATFORM=claude` |
| Gemini CLI | `GEMINI.md` | `LITEAI_PLATFORM=gemini` |
| Codex | Codex conventions | `LITEAI_PLATFORM=codex` |

When a platform is set, LiteAI loads both the platform-specific file and native `.liteai/` conventions.

## Agent memory

### What it is

Agent memory is a system where the AI agent can **write** persistent notes across sessions. Unlike instructions (which you author), memory is authored by the agent itself.

### Memory scopes

| Scope | Location | Shared across |
|---|---|---|
| **User** | `~/.liteai/memory/<agent>/user/` | All projects |
| **Project** | `~/.liteai/memory/<agent>/project/` | Same project, all sessions |
| **Local** | Project-local | Current workspace only |

### Memory tools

The agent has three built-in tools for memory management:

| Tool | Description |
|---|---|
| `readMemory` | Read the agent's memory files |
| `writeMemory` | Create or overwrite a memory file |
| `editMemory` | Edit specific sections of a memory file |

### Enabling/disabling memory

Memory is enabled by default. To control it:

```json
// settings.json
{
  "memory": "project"  // "user" | "project" | "local" | "disabled"
}
```

Or via environment variable:

```bash
export LITEAI_DISABLE_MEMORY=true
```

### Memory best practices

- Memory works best for **facts** about your project: coding conventions, architecture decisions, team preferences
- The agent automatically writes memory when it discovers important patterns
- Review memory files periodically to prune outdated information
- Memory files are plain markdown — you can edit them directly

:::note
The memory system is being evolved toward a unified, project-scoped model. See the [Context & memory roadmap](/roadmap/context-memory-roadmap) for planned improvements.
:::

## What's next?

- [**Explore the .liteai directory**](/getting-started/explore-liteai-directory) — Where all these files live
- [**Settings reference**](/configuration/settings) — Memory and instruction configuration options
- [**Architecture: Context & memory pipeline**](/architecture/context-memory) — Technical deep dive
