---
title: "Roadmap: Engine & session"
description: "Detailed implementation status of LiteAI's engine, session, coordinator, and swarm features."
---

# Engine & session roadmap

Detailed feature status for the session engine, agent system, and coordinator swarm subsystems.

## Session engine (141/141 ✅)

All engine features are fully implemented:

| Area | Features | Status |
|---|---|---|
| Agent loop & query | Query assembly, tool dispatch, streaming | ✅ All |
| Session modes | Normal, Plan, Coordinator, Headless | ✅ All |
| Compaction | Auto-compaction, token counting, content optimization | ✅ All |
| Checkpointing | Snapshot, undo, revert | ✅ All |
| Tool system | 30+ native tools, tool profiles, MCP integration | ✅ All |
| Permission service | Classification, durable rules, mode enforcement | ✅ All |
| Subagent system | Fork spawning, sidechain transcripts, resume pipeline | ✅ All |

## Coordinator & swarms (114/117 — 97%)

### Implemented ✅

| Category | Count | Features |
|---|---|---|
| Coordinator mode | 9 | Mode detection, system prompt, tool filter, mutual exclusion |
| Coordinator tools | 7 | task, send_message, task_stop, team_create, team_delete, yield_turn, structured_output |
| Mailbox IPC | 15 | Message routing, file-based inbox, lockfile concurrency, broadcast, structured schemas |
| Teammate runner | 26 | Type foundation, AsyncLocalStorage isolation, spawn/lifecycle, continuous loop, events |
| Permission sync | 26 | Permission bridge (dual-transport), leader handler, classifier, PermissionService integration |
| Built-in agents | 11 | Registry, verification agent (adversarial, read-only, VERDICT reporting) |
| Team infrastructure | 11 | Directory management, sanitization, config, cleanup, scratchpad |
| Structured output | 5 | Tool registration, WeakMap caching, coordinator allowlist |

### Planned ❌

| Feature | Description |
|---|---|
| Guide agent | Documentation assistant with read-only tools + web fetch |
| Guide agent model | Cost-optimized model (small/haiku equivalent) |
| Guide agent context | Skills/MCP context injection |
