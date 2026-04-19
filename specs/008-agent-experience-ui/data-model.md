# Data Model: Agent Experience UI

## Overview

This document defines the canonical event contracts and UI state entities for the Agent Experience UI feature. All schemas are derived from the **actual codebase** — not speculative designs.

## Event Contracts (Backend → SSE → Frontend)

All events below are already defined as `BusEvent.define()` in the core package and automatically reach the SSE stream via the `Bus` → `GlobalBus` bridge. No new backend event definitions are needed.

### Agent Events (source: `packages/core/src/agent/events.ts`)

```typescript
// AgentEvent.Spawned — published by runner.ts when a child agent starts
{
  type: "agent.spawned"
  properties: {
    agentId: string      // Unique ID for this agent session
    agentType: string    // Agent type name (e.g., "lite", "task")
    parentId: string     // Parent session ID
    isAsync: boolean     // True for background (async) agents
  }
}

// AgentEvent.Progress — published by lifecycle.ts during execution
{
  type: "agent.progress"
  properties: {
    agentId: string
    activity: string     // Human-readable activity description
  }
}

// AgentEvent.Completed — published by runner.ts on agent termination
{
  type: "agent.completed"
  properties: {
    agentId: string
    agentType: string
    status: "completed" | "failed" | "killed"
    duration: number     // Milliseconds
    usage: {
      totalTokens: number
      toolCalls: number
      duration: number   // Milliseconds
    }
  }
}

// AgentEvent.TerminalNotification — published by lifecycle.ts for background agents
{
  type: "agent.terminal_notification"
  properties: {
    agentId: string
    status: "completed" | "failed" | "killed"
    description: string
    usage: { totalTokens: number; toolCalls: number; duration: number }
    error?: string
    partialResult?: string
  }
}
```

### Plan Events (source: `packages/core/src/session/index.ts`)

```typescript
// Session.Event.PlanStateChanged — published by PlanModeStateRef.update()
{
  type: "plan.state_changed"
  properties: {
    sessionID: SessionID   // Branded string type
    active: boolean        // True = plan mode entered, False = plan mode exited
    planFilePath: string   // Deterministic file path for the plan
    turnsSincePlanReminder: number
  }
}

// Session.Event.PlanApprovalRequested — published by ExitPlanModeTool
{
  type: "plan.approval_requested"
  properties: {
    sessionID: SessionID
    planText: string       // Full plan markdown text
    planFilePath: string
  }
}
```

## UI State Entities (Frontend)

### `AgentPanelState` (new — to be created in `packages/ui`)

Reactive store tracking all active/completed agents for the current session.

```typescript
interface AgentEntry {
  agentId: string
  agentType: string
  parentId: string
  isAsync: boolean
  status: "running" | "completed" | "failed" | "killed"
  activity?: string           // Latest progress activity text
  duration?: number           // Set on completion
  usage?: {
    totalTokens: number
    toolCalls: number
    duration: number
  }
  error?: string              // Set on failure (from TerminalNotification)
  partialResult?: string      // Set on kill/failure (from TerminalNotification)
}

interface AgentPanelState {
  agents: Map<string, AgentEntry>   // agentId → entry
  drawerOpen: boolean               // Whether the agent panel drawer is visible
  selectedAgentId?: string          // Agent whose transcript is being viewed
}
```

**State Transitions**:
- `agent.spawned` → Insert entry with `status: "running"`, auto-open drawer if first agent
- `agent.progress` → Update `activity` field on matching entry
- `agent.completed` → Update `status`, `duration`, `usage`; if `status === "failed"`, set error icon
- `agent.terminal_notification` → Update `error` and `partialResult` fields for background agents

### `PlanApprovalState` (existing — already in `chat-pane.tsx`)

Already implemented via SolidJS signals in `chat-pane.tsx:153-155`:

```typescript
// Existing signals (no changes needed):
const [isPlanModeActive, setPlanModeActive] = createSignal(false)
const [isApprovalPending, setApprovalPending] = createSignal(false)
const [planText, setPlanText] = createSignal("")
```

**State Transitions** (already wired in `chat-pane.tsx:157-180`):
- `plan.state_changed` → `setPlanModeActive(active)`
- `plan.approval_requested` → `setApprovalPending(true)`, `setPlanText(planText)`
- User approves → `setApprovalPending(false)`, callback to host
- User rejects → `setApprovalPending(false)`, callback to host

## Metadata Linkage Pattern (Existing)

The `task` tool already propagates sub-agent `sessionId` via part metadata:

```typescript
// message-parts/tool.tsx:26-37 (existing pattern):
const partMetadata = () => part().metadata ?? part().state.metadata ?? {}
const taskId = () => {
  if (part().tool !== "task") return
  const value = partMetadata().sessionId
  if (typeof value === "string" && value) return value
}
const taskHref = () => sessionLink(taskId(), "", data.sessionHref)
```

This pattern will be extended for FR-006 (inline agent chip) to additionally trigger the Agent Panel drawer open with the selected agent.
