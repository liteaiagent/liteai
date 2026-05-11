---
title: Create custom subagents
description: "Define specialized agent personas with custom prompts, tool restrictions, and execution modes."
---

# Create custom subagents

Subagents are specialized agent personas that you can define and spawn for specific tasks. Each subagent starts with a **clean context** — its own system prompt, tool access, and conversation history — so it operates independently from the parent.

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

The text after the frontmatter (`---`) is the agent's **system prompt**. This is the primary instruction that shapes the agent's behavior.

### Frontmatter fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | Yes | — | Unique identifier for the agent |
| `description` | string | Yes | — | Short description (shown in agent selector) |
| `model` | string | No | Inherits session model | Override the session's model (e.g., `claude-sonnet-4-20250514`) |
| `tools` | string[] | No | All tools available | Whitelist of allowed tools (all others blocked) |
| `disabledTools` | string[] | No | None blocked | Blocklist of specific tools to remove |
| `maxTurns` | number | No | `200` | Maximum agentic turns before force-stop |
| `permissionMode` | string | No | `default` | Permission mode: `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan`, `bubble` |
| `background` | boolean | No | `false` | Always run as background task when spawned |
| `memory` | string | No | Disabled | Persistent memory scope: `user`, `project`, or `local` |
| `skills` | string[] | No | None | Skills to preload when the agent starts |
| `mcpServers` | array | No | Inherits parent | MCP servers to connect (by name or inline `{ name: config }`) |
| `hooks` | object | No | None | Session-scoped hooks registered when agent starts |
| `effort` | string | No | Inherits session | Effort level: `low`, `medium`, `high`, `max` |
| `isolation` | string | No | None (shared workspace) | Isolation mode: `worktree` (git worktree) or `remote` (Docker container) |
| `initialPrompt` | string | No | None | Text prepended to the agent's first user turn |
| `timeout` | number | No | `1800000` (30 min) | Wall-clock timeout in milliseconds before force-stop |
| `thinking` | boolean | No | `false` | Enable extended thinking for the agent |
| `color` | string | No | Auto-assigned | Display color in the agent panel |

## Agent discovery

LiteAI discovers agents from two locations:

```
1. Global:   ~/.liteai/agents/**/*.md
2. Project:  .liteai/agents/**/*.md
```

Project agents take precedence when names collide with global agents.

## Spawning subagents

### Fresh agents (default)

When you specify a `subagent_type`, the agent spawns with a **clean context**:

```
> Use the reviewer agent to check src/auth/service.ts for security issues.
```

The agent tool call includes the type:
```json
{
  "subagent_type": "reviewer",
  "prompt": "Review src/auth/service.ts for security vulnerabilities..."
}
```

A fresh agent gets:
- An **empty** conversation history — it has no knowledge of the parent's conversation
- Its **own system prompt** from the markdown body of its agent definition
- Tool access scoped to its `tools`/`disabledTools` configuration
- An independent abort controller (can be stopped without affecting parent)

Because the fresh agent starts with zero context, **brief it like a colleague who just walked in** — explain what you're trying to accomplish, what you've already learned, and provide enough context for the agent to make judgment calls.

### Fork mode (feature-gated)

When the fork feature is enabled and `subagent_type` is **omitted**, the agent creates a fork that inherits the parent's full context:

```
> Research how the authentication middleware handles JWT refresh tokens
> while I continue working on the session cleanup.
```

The agent tool call omits the type:
```json
{
  "prompt": "Research how the authentication middleware handles JWT refresh..."
}
```

A forked agent gets:
- The parent's **full conversation history** (deep-cloned)
- The parent's **exact rendered system prompt** (byte-identical)
- The parent's **exact tool pool** (for cache-identical API prefixes)
- Access to the parent's **prompt cache** (reduces LLM costs by ~70%)
- An independent abort controller

Fork prompts are **directives**, not briefings — the fork already has all your context, so tell it what to do rather than re-explaining the situation.

:::note
Fork mode requires the `LITEAI_FORK_SUBAGENT` feature flag. It is disabled in coordinator mode and non-interactive sessions.
:::

### Sidechain transcripts

When a subagent completes (fresh or forked), its conversation is persisted as a **sidechain transcript**:

```typescript
interface TranscriptMessage {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: number
}
```

The parent agent can read sidechain transcripts to review what the subagent did.

## Built-in agents

LiteAI ships with these built-in agents:

| Agent | Purpose | Tool restrictions |
|---|---|---|
| **Build** | General-purpose coding agent | Full tool access |
| **Plan** | Research and planning | Read-only tools |
| **Explore** | Code exploration and search | Read-only tools |
| **Verification** | Adversarial code review | Read-only tools only |

The verification agent is primarily used in coordinator mode as a quality gate.

## Durability and resume

Background subagents support **durable execution**:
- If the parent session is interrupted, background agents continue running
- Agents can be resumed by re-connecting to the session
- Sidechain transcripts persist in SQLite even after the agent completes

## What's next?

- [**Run agent teams**](/build/agent-teams) — Coordinator mode for multi-agent orchestration
- [**Architecture: Coordinator & swarms**](/architecture/coordinator-swarms) — Technical deep dive
- [**Extend LiteAI**](/getting-started/extend-liteai) — Overview of all extension points
