---
title: "Architecture: Context & memory pipeline"
description: "How LiteAI assembles system prompts, loads instructions, and manages agent memory."
---

# Context & memory pipeline

> **Source:** `src/session/engine/instruction.ts`, `src/session/engine/system.ts`, `src/platform/`, `src/agent/memory.ts`

## System prompt pipeline

The system prompt is assembled using a **section registry** that caches and deduplicates content:

| Phase | Sections | Caching |
|---|---|---|
| **Static** | Identity, rules, tool descriptions | Cached per-session |
| **Project** | AGENTS.md, platform profile, memory | Cached, invalidated on change |
| **Dynamic** | Environment, active files, session metadata | Rebuilt every turn |

## Instruction loading chain

Instructions are loaded in priority order:

1. **Global** — `~/.liteai/AGENTS.md`
2. **Project root** — `<worktree>/AGENTS.md`
3. **findUp** — Walk from cwd to root, collecting all AGENTS.md files
4. **Custom paths** — `config.instructions` array
5. **Remote URLs** — HTTP fetch with 5s timeout
6. **Subdirectory JIT** — Loaded when agent accesses files in subdirectories with their own AGENTS.md

A **claim guard** prevents duplicate injection per message.

## Platform profiles

| Profile | Instruction file | Set via |
|---|---|---|
| `liteai` (default) | `AGENTS.md` | Default |
| `claude` | `CLAUDE.md` | `LITEAI_PLATFORM=claude` |
| `gemini` | `GEMINI.md` | `LITEAI_PLATFORM=gemini` |
| `codex` | Codex conventions | `LITEAI_PLATFORM=codex` |

## Agent memory (current)

Per-agent, per-scope memory in `~/.liteai/memory/<agent>/{user,project,local}/`.

Tools: `readMemory`, `writeMemory`, `editMemory` — with path traversal guards.

Scope priority: `local > project > user`.

## Planned: Unified memory

The per-agent model is being replaced with project-scoped memory under `~/.liteai/projects/<id>/memory/`. See [Context & memory roadmap](/roadmap/context-memory-roadmap).

## What's next?

- [**Instructions & memory**](/getting-started/memory) — User guide
- [**Session engine**](/architecture/session-engine) — How the pipeline feeds the loop
