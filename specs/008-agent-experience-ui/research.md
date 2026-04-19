# Phase 0 Research: Agent Experience UI

## R-001: Agent Event SSE Transport — Already Implemented

- **Decision**: Agent events (`agent.spawned`, `agent.progress`, `agent.completed`, `agent.terminal_notification`) are **already** emitted to the SSE stream via the Bus→GlobalBus bridge (`packages/core/src/bus/index.ts:60`). No backend work is needed to transport these events.
- **Rationale**: The `Bus.publish()` → `GlobalBus.emit("event", ...)` bridge is universal. Every `BusEvent.define()` event automatically reaches the SSE `/event` endpoint. Verified by tracing `AgentEvent.Spawned` from `runner.ts:382` through `Bus.publish` → `bus/index.ts:60` → `GlobalBus.emit` → `global.ts:200` SSE handler.
- **Key Files**: [bus/index.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/bus/index.ts), [agent/events.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/agent/events.ts), [agent/runner.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/agent/runner.ts)

## R-002: Plan Event SSE Transport — Already Implemented

- **Decision**: Plan events (`plan.state_changed`, `plan.approval_requested`) are **already** emitted to the SSE stream via the same Bus→GlobalBus bridge. No backend work needed.
- **Rationale**: `PlanModeStateRef.update()` publishes `Session.Event.PlanStateChanged` on active transitions. `ExitPlanModeTool` publishes `Session.Event.PlanApprovalRequested`. Both reach SSE via GlobalBus.
- **Key Files**: [session/plan-mode-state.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/plan-mode-state.ts), [session/index.ts:L228-244](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/index.ts#L228-L244)

## R-003: Plan Approval Dock — Already Implemented

- **Decision**: `PlanApprovalDock` component **already exists** at `packages/ui/src/components/plan-approval-dock.tsx`. `chat-pane.tsx` already subscribes to `plan.state_changed` and `plan.approval_requested` events and renders the dock with approve/reject callbacks.
- **Rationale**: Verified by reading `chat-pane.tsx:153-180` (signal + event subscription wiring) and `chat-pane.tsx:408-420` (dock rendering).
- **Gap**: The web host `createWebChatController()` does **not** provide the `events` property on `ChatController`, so the subscriptions are currently dead code in the web context. The VSCode host may wire it differently.
- **Key Files**: [plan-approval-dock.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/components/plan-approval-dock.tsx), [chat-pane.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/panes/chat/chat-pane.tsx)

## R-004: Web ChatController events Gap — Critical

- **Decision**: The `ChatController` interface defines an optional `events?: { subscribe(...) }` property, but the web implementation (`createWebChatController()` in `web-chat-controller.ts`) does **not** wire it. The `GlobalSDK` context already has a `createGlobalEmitter()` (`event` property) that receives all SSE events — this must be bridged into the `ChatController.events` API.
- **Rationale**: The emitter already exists (`useGlobalSDK().event`), it receives all SSE payloads including `plan.*` and `agent.*` events. The missing piece is a thin adapter that filters events by `directory` and exposes `subscribe(eventType, callback)`.
- **Alternatives Considered**: (1) Components directly importing `useGlobalSDK` — rejected because it breaks the controller abstraction and makes components host-dependent. (2) New event bus — rejected because the emitter already exists.
- **Key Files**: [web-chat-controller.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/web/src/context/web-chat-controller.ts), [global-sdk.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/web/src/context/global-sdk.tsx)

## R-005: Actual Agent Event Schemas (Ground Truth)

- **Decision**: Use the existing `AgentEvent` schemas from `packages/core/src/agent/events.ts` as the canonical event contracts, not the fictional schemas in the old data-model.md.
- **Actual Schemas**:
  - `AgentEvent.Spawned`: `{ agentId, agentType, parentId, isAsync }`
  - `AgentEvent.Progress`: `{ agentId, activity }`
  - `AgentEvent.Completed`: `{ agentId, agentType, status: "completed"|"failed"|"killed", duration, usage: { totalTokens, toolCalls, duration } }`
  - `AgentEvent.TerminalNotification`: `{ agentId, status, description, usage, error?, partialResult? }`
- **Note**: There is **no** `agent.backgrounded` event in the codebase. The spec's FR-001 reference to `backgrounded` is phantom. The `isAsync` flag on `AgentEvent.Spawned` indicates background agents; terminal state is communicated via `AgentEvent.Completed` with appropriate status.

## R-006: Actual Plan Event Schemas (Ground Truth)

- **Decision**: Use existing `Session.Event` schemas from `packages/core/src/session/index.ts` as canonical contracts.
- **Actual Schemas**:
  - `Session.Event.PlanStateChanged`: `{ sessionID, active: boolean, planFilePath, turnsSincePlanReminder }`
  - `Session.Event.PlanApprovalRequested`: `{ sessionID, planText, planFilePath }`
- **Note**: These differ from the old data-model.md which used `state: "active"|"completed"|...` enum. The real API uses a simple `active: boolean` toggle.

## R-007: Inline Agent Link/Chip Pattern — Already Exists for Tasks

- **Decision**: The inline "explore agent" link pattern already exists for the `task` tool. `message-parts/tool.tsx` extracts `metadata.sessionId` and uses `sessionLink()` to build a navigation href. The same pattern will be extended or reused to link agents in the drawer.
- **Rationale**: `tool.tsx:31-37` shows: `const value = partMetadata().sessionId` → `sessionLink(taskId(), "", data.sessionHref)`. This navigates to the child session. For FR-006, the link should additionally open the Agent Panel drawer.
- **Key Files**: [message-parts/tool.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/components/message-parts/tool.tsx)

## R-008: No Agent Panel Drawer Exists

- **Decision**: There is no `AgentPanel`, `AgentDrawer`, or equivalent component in the codebase. The `todo-panel-motion.stories.tsx` demonstrates an animated drawer pattern with spring physics that can be used as the architectural reference for the Agent Panel.
- **Alternatives Considered**: (1) Side panel — rejected because the chat UI already has a side panel for file editing and it would conflict with layout. (2) Bottom sheet — rejected because it doesn't allow viewing the chat simultaneously. (3) Slide-in drawer from the right — **selected** because it matches the existing todo-panel drawer motion pattern and allows simultaneous chat interaction.
- **Key Files**: [todo-panel-motion.stories.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/components/todo-panel-motion.stories.tsx)

## R-009: MVP Reference Unavailability

- **Decision**: The specification references `liteai_cli_mvp/src` as the ground-truth implementation, but this codebase is absent from the workspace. All designs will be grounded on the **actual existing codebase** (the real `AgentEvent` schemas, the real plan mode infra, the real SSE transport chain) rather than reverse-engineering an unavailable reference.
- **Rationale**: The existing codebase has evolved beyond the CLI MVP. The core agent lifecycle, event bus, and plan mode state management are already implemented with production-grade patterns. Constraint C-001 is reinterpreted as "functional equivalence to specified behavior" rather than literal code-parity with absent files.
