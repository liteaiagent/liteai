# Quickstart: Agent Experience UI

## Prerequisites

- Bun 1.x installed
- All workspace packages built (`bun install` from monorepo root)
- A running LiteAI server instance (`bun dev` from `packages/core`)

## Verification Steps

### 1. Verify Agent Events Reach SSE

Open the SSE stream directly and trigger a sub-agent:

```bash
# Terminal 1: Listen to SSE events
curl -N http://localhost:3000/event 2>/dev/null | grep -E "agent\." 

# Terminal 2: Send a prompt that triggers a sub-agent
# (use the web UI or any client to send a coding task)
```

Expected output: you should see `agent.spawned`, `agent.progress`, and `agent.completed` events in the stream.

### 2. Verify Plan Events Reach SSE

```bash
# Terminal 1: Listen for plan events
curl -N http://localhost:3000/event 2>/dev/null | grep -E "plan\."

# Terminal 2: Send a prompt that triggers plan mode
# (e.g., "create an implementation plan for adding a new feature")
```

Expected output: `plan.state_changed` (active: true), then `plan.approval_requested` with plan text.

### 3. Verify UI Components

After implementing the Agent Panel:

1. Open the web UI
2. Start a session and trigger a sub-agent task
3. The Agent Panel drawer should slide out automatically
4. Agent rows should update in real-time (status chips, activity text)
5. Clicking an agent row should swap to the sidechain transcript view

### 4. Run Scoped Tests

```bash
# From packages/ui:
bun test test/components/agent-panel
bun test test/panes/chat/chat-pane
```

### 5. Typecheck and Lint

```bash
bun typecheck 2>&1 | Out-String
bun lint:fix
```
