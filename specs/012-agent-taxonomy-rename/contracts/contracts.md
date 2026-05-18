# Contracts: Agent Taxonomy & Rename (Phase 1)

Phase 1 is an internal naming refactor. No external-facing contracts (APIs, CLI schemas, or protocol definitions) are introduced or modified.

## Internal Contract Changes

The following **internal** identifiers change, affecting tool schema contracts presented to LLM models:

| Contract Surface | Before | After |
|-----------------|--------|-------|
| Tool schema `name` field (model-facing) | `"task"` | `"agent"` |
| Tool schema `name` field (model-facing) | `"task_stop"` | `"agent_stop"` |
| Tool parameter `task_id` | Remains `task_id` | Remains `task_id` (parameter names are backward-compatible) |
| Tool parameter `subagent_type` | Remains `subagent_type` | Remains `subagent_type` |

> **Note**: The `task_id` parameter name within the `agent` tool schema is preserved intentionally — it refers to a session resumption ID, and renaming it would break model behavior without benefit. The parameter description already says "task" in a generic sense (a unit of work), not as the tool name.
