---
title: Create custom subagents
description: "Define specialized agent personas with custom prompts, tool restrictions, and execution modes."
---

# Create custom subagents

Subagents are specialized agent personas that you can define and spawn for specific tasks. They run in isolated contexts with their own system prompts, tool access, and memory.

## Agent definition format

Create a markdown file in `.liteai/agents/` with YAML frontmatter:

```markdown
---
name: reviewer
description: Code review specialist
model: claude-sonnet-4-20250514
tools:
  - read_file
  - search
  - list_directory
  - glob
---

You are a senior code reviewer. Focus on:
- Logic errors and edge cases
- Performance implications
- Security vulnerabilities
- Code style consistency

Never suggest changes without explaining the reasoning.
Report findings with severity: CRITICAL, WARNING, or INFO.
```

### Frontmatter fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Unique identifier for the agent |
| `description` | string | Yes | Short description (shown in agent selector) |
| `model` | string | No | Override the session's model |
| `tools` | string[] | No | Whitelist of allowed tools (all others blocked) |
| `disabledTools` | string[] | No | Blocklist of tools to remove |
| `maxTurns` | number | No | Maximum turns before force-stop |
| `systemPrompt` | string | No | Override entire system prompt (advanced) |

## Agent discovery

LiteAI discovers agents from two locations:

```
1. Global:   ~/.liteai/agents/**/*.md
2. Project:  .liteai/agents/**/*.md
```

Project agents take precedence when names collide with global agents.

## Spawning subagents

### From the agent (fork mode)

The primary agent can spawn subagents using the `agent` tool:

```
> Use a background agent to write tests for src/auth/service.ts
> while you continue refactoring the main module.
```

The agent will call the `agent` tool, which:
1. Creates a **fork** of the current session
2. Shares the parent's prompt cache (cost-efficient)
3. Runs the subagent in the background
4. Returns results via sidechain transcripts

### Fork isolation

Each fork subagent gets:
- Its own conversation history (deep-cloned from parent)
- Its own tool state and permission context
- Access to the parent's prompt cache (reduces LLM costs by ~70%)
- An independent `AbortController` (can be stopped without affecting parent)

### Sidechain transcripts

When a fork completes, its conversation is persisted as a **sidechain transcript**:

```typescript
interface TranscriptMessage {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: number
}
```

The parent agent can read sidechain transcripts to review what the fork did.

## Built-in agents

LiteAI ships with these built-in agents:

| Agent | Purpose | Tool restrictions |
|---|---|---|
| **Default** | General-purpose coding agent | Full tool access |
| **Verification** | Adversarial code review | Read-only tools only |

The verification agent is primarily used in coordinator mode as a quality gate.

## Durability and resume

Fork subagents support **durable execution**:
- If the parent session is interrupted, background forks continue running
- Forks can be resumed by re-connecting to the session
- Sidechain transcripts persist in SQLite even after the fork completes

## What's next?

- [**Run agent teams**](/build/agent-teams) — Coordinator mode for multi-agent orchestration
- [**Architecture: Coordinator & swarms**](/architecture/coordinator-swarms) — Technical deep dive
- [**Extend LiteAI**](/getting-started/extend-liteai) — Overview of all extension points
