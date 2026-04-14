# Phase 1e — Background Task Notification Injection (Engine)

**Scope:** `packages/core/src/session/engine/` — engine-level changes.
**Depends on:** Phase 1c (core backend), Phase 1d (UI).
**Goal:** Notify the agent when a backgrounded command completes, so it doesn't have to poll manually.

## The Problem

After Phase 1c, the agent must manually call `command_status` to check if a background task finished.
This works, but liteai_cli_mvp goes further: when a background task completes, it **injects a `task_notification`** into the conversation so the agent is automatically told.

This makes the UX smoother:
1. Agent backgrounds a `bun typecheck`
2. Agent continues with other work 
3. Task completes → notification injected → agent reacts to results

Without this, the agent must remember to poll, which wastes tokens and can be forgotten.

## Complexity Assessment

This requires changes to the **engine loop** (`loop.ts` / `query.ts`):
- The `queryLoop` generator yields events. We'd need a mechanism to inject events *between* turns.
- The engine currently has no concept of "interrupt the current plan to deliver a notification."
- Options:
  1. **Inter-turn injection:** After a turn ends and before the next starts, check `BackgroundTaskRegistry` for completed tasks and synthesize a system message.
  2. **GeneratorResultEvent extension:** Add a new control action like `"background-task-complete"` that the engine can act on.
  3. **Synthetic user message:** Inject a synthetic user message with task results (used by liteai_cli_mvp's `task_notification`).

## Decision: Create Separate Roadmap

This is architecturally complex enough to warrant its own roadmap folder for detailed design.

The engine loop is the heart of the system — changes there have wide blast radius and need:
- Careful analysis of the generator lifecycle
- Understanding of how synthetic messages interact with conversation state
- Testing across multi-turn, multi-task scenarios
- Consideration of how this interacts with subtasks/agents

## Recommendation

Create: `roadmap/engine/background-task-notifications/`

For now, Phase 1c + 1d deliver the full async lifecycle via manual polling (`command_status`). The agent prompt (Phase 1c) explicitly teaches the agent to use `command_status` with high `WaitDurationSeconds`, so the polling is efficient (one call, sleeps up to 5 minutes).

The notification injection is a **nice-to-have optimization** that can be added later without breaking changes.

## Files That Would Be Affected (Future)

| File | Change | Risk |
|------|--------|------|
| `engine/loop.ts` | Inject completion events between turns | **High** — core orchestration |
| `engine/query.ts` | Yield synthetic messages | **High** — generator lifecycle |
| `session/events.ts` | New `TaskNotificationEvent` type | **Medium** — event schema |
| `session/message.ts` | Support synthetic message type | **Medium** — message model |

## Session Estimate: **2+ sessions** (design + implement + test)
