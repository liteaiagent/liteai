---
title: Feature status overview
description: "Consolidated view of LiteAI's feature implementation status — what's built, what's in progress, and what's planned."
---

# Feature status overview

This page provides a transparent view of LiteAI's feature implementation status, consolidated from our internal engineering audits. Last audited: **2026-05-10**.

## Summary dashboard

| Subsystem | ✅ Done | 🔶 Partial | ❌ Planned | Total | Completion |
|---|:---:|:---:|:---:|:---:|:---:|
| [Engine & session](/roadmap/engine-session) | 141 | 0 | 0 | 141 | 100% |
| [Coordinator & swarms](/roadmap/engine-session) | 114 | 0 | 3 | 117 | 97% |
| [Addons & configuration](/roadmap/addons-configuration) | 121 | 0 | 0 | 121 | 100% |
| [Server & API](/roadmap/addons-configuration) | 43 | 0 | 0 | 43 | 100% |
| [Infrastructure](/roadmap/addons-configuration) | 78 | 0 | 0 | 78 | 100% |
| [Context & memory](/roadmap/context-memory-roadmap) | 34 | 0 | 42 | 76 | 45% |
| **Total** | **531** | **0** | **45** | **576** | **92%** |

## What's fully implemented

- ✅ **Session engine** — Agent loop, query assembly, compaction, checkpointing, plan mode
- ✅ **Agent system** — Fork subagents, resume, sidechain transcripts
- ✅ **Coordinator mode** — State machine, teammate runner, mailbox IPC, permission bridge
- ✅ **Provider adapters** — Anthropic, OpenAI, Google, Bedrock, Vertex, OpenAI-compatible
- ✅ **Tool system** — 30+ native tools, tool profiles, permission classification
- ✅ **MCP integration** — stdio/HTTP/SSE transports, OAuth, agent-scoped servers
- ✅ **Plugin system** — Manifest, lifecycle, environment variables
- ✅ **Skill system** — SKILL.md format, discovery, agent-scoped skills
- ✅ **Hook system** — Lifecycle, command, HTTP hooks
- ✅ **Configuration** — Layered merge, Zod schema, platform profiles
- ✅ **HTTP server** — Hono app, middleware stack, 30+ API routes
- ✅ **Storage** — SQLite, full-text search, session persistence
- ✅ **Telemetry** — OpenTelemetry, Perfetto export
- ✅ **LSP** — 40 language server adapters
- ✅ **Isolation** — Docker sandboxing, worktree isolation

## What's partially done

- 🔶 **Coordinator swarms** — Guide agent (documentation assistant) planned but not yet implemented

## What's planned

Most planned features are in the **context & memory** domain:

- ❌ Unified project-scoped memory system
- ❌ Conversation history & recall
- ❌ Background memory extraction
- ❌ Skills extraction (auto-learning)
- ❌ Session export
- ❌ Content replacement (large result → summary)
- ❌ Context instructions v2 (modular rules, `.liteai/rules/`)

See the detailed roadmap pages for specifics:
- [**Engine & session**](/roadmap/engine-session) — Engine, loop, coordinator
- [**Addons & configuration**](/roadmap/addons-configuration) — MCP, plugins, skills, hooks, providers, server
- [**Context & memory**](/roadmap/context-memory-roadmap) — Memory, recall, skills extraction
