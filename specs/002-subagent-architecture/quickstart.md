# Quickstart: Sub-Agent Architecture

**Feature**: 002-subagent-architecture  
**Date**: 2026-04-11

## What This Feature Does

The sub-agent architecture transforms LiteAI from a single-threaded agent model into a full orchestration platform where agents can spawn child agents with isolated contexts, independent permissions, dedicated transcript recording, and structured lifecycle management.

## Key Concepts

### 1. Agent Definition Types

Agents come from three sources, merged in priority order:

1. **Built-in/default agents**
2. **Workspace or project-level agents (user-provided)**
3. **Runtime/ephemeral agents (injected at execution)**

Note: Higher-numbered items override lower-numbered ones in the event of a conflict.

Each agent is configured via a `.md` file with YAML frontmatter:

```yaml
---
description: "Research and analyze code without making changes"
mode: subagent
tools: ["read_file", "search", "grep"]
disallowedTools: ["write_file", "edit"]
permissionMode: plan
omitLiteaiMd: true
thinking: false
timeout: 900000  # 15 minutes
---
You are a read-only research agent. Never modify files.
```

### 2. Context Forking

When a sub-agent is spawned, it receives:
- **Cloned**: parent's file cache (read without re-reading files)
- **Linked**: abort controller (parent cancellation propagates down)
- **Wrapped**: app state (permission-safe access)
- **Fresh**: tool decisions, messages (complete isolation)

### 3. Permission Sandboxing

Background agents never block on permission prompts — operations are silently denied. Parent's elevated permissions always take precedence.

### 4. Sidechain Transcripts

Sub-agent messages are recorded to separate files. The parent only sees the final task result, keeping its context window lean.

## Typical Flow

```
Parent Session
  └─ LLM decides to spawn "explore" agent
      └─ runAgent() called
          ├─ createSubagentContext() — fork parent state
          ├─ initializeAgentMcpServers() — connect declared servers
          ├─ executeSubagentStartHooks() — run lifecycle hooks
          ├─ preloadSkills() — inject declared skills
          ├─ queryLoop() — LLM interaction turns
          │   ├─ criticalSystemReminder injected each turn
          │   └─ sidechain transcript recorded per message
          ├─ result returned to parent
          └─ cleanup() — 12-step deterministic teardown
```

## Testing

```bash
# Run agent context tests
bun test test/agent/context.test.ts

# Run permission sandbox tests
bun test test/permission/sandbox.test.ts

# Run full lifecycle integration tests
bun test test/agent/runner.test.ts
```
