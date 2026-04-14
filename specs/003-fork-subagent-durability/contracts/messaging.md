# Contract: Messaging (Teammate Re-engagement)

**Feature**: 003-fork-subagent-durability
**Date**: 2026-04-14
**Type**: Internal API Contract

## MVP Grounding

> This contract is derived from `tools/SendMessageTool/SendMessageTool.ts:800-873`. The 3-way routing logic is the critical behavioral contract.

---

## Overview

Defines the messaging interface for teammate re-engagement. When a user sends a message to a previously-completed or interrupted background agent, the messaging system provides 3-way routing based on the agent's current lifecycle state.

## Routing Logic

```typescript
/**
 * Route a message to a background agent.
 * Implements 3-way routing based on agent lifecycle state.
 *
 * @param recipientNameOrId - Agent name (via registry) or raw agent ID
 * @param message - Plain text message content
 * @param sessionContext - Current session context for resume operations
 * @returns Routing result with success/failure and description
 */
async function routeMessage(params: {
  recipientNameOrId: string
  message: string
  sessionContext: SessionContext
}): Promise<MessageRoutingResult>
```

## 3-Way Routing Table

| Agent State | Action | Result | MVP Reference |
|-------------|--------|--------|---------------|
| **Running** (task exists, status=running) | Queue message for delivery at next tool round | `"Message queued for delivery to {name} at its next tool round."` | `SendMessageTool.ts:809-821` |
| **Stopped** (task exists, status≠running) | Auto-resume in background with message as prompt | `"Agent {name} was stopped ({status}); resumed it in the background with your message."` | `SendMessageTool.ts:823-844` |
| **Evicted** (no task in session state) | Resume from disk transcript with message as prompt | `"Agent {name} had no active task; resumed from transcript in the background with your message."` | `SendMessageTool.ts:846-872` |

## Name Resolution

```
1. Check AgentNameRegistry for registered name → agentId
2. If not found, attempt raw agentId format validation
3. If agentId found, check task state in session
4. Route based on task state (see 3-way table above)
5. If neither name nor agentId resolves, fall through to teammate mailbox routing
```

## Preconditions

1. Input message is a plain text string (not structured)
2. Recipient is not `"*"` (broadcast)
3. Session context is available for resume operations

## Postconditions

1. **Running**: Message is queued in the agent's pending message queue
2. **Stopped**: Agent is resumed via `resumeAgentBackground()` with the message as the new prompt
3. **Evicted**: Agent is resumed from disk transcript via `resumeAgentBackground()`

## Error Conditions

| Condition | Behavior | MVP Reference |
|-----------|----------|---------------|
| Agent registered but no transcript | Return failure: `"Agent {name} is registered but has no transcript to resume."` | `SendMessageTool.ts:864-871` |
| Resume fails | Return failure with error message | `SendMessageTool.ts:837-843` |
| Agent not found by name or ID | Fall through to teammate mailbox routing | `SendMessageTool.ts:874+` |

## Queue Delivery Mechanism

For running agents, messages are queued via a pending message queue on the agent's task state. The agent's query loop checks the queue at the start of each tool round (between API calls) and injects queued messages as user turns.

```typescript
/**
 * Queue a message for delivery to a running agent.
 * The message is delivered at the agent's next tool round.
 */
function queuePendingMessage(
  agentId: string,
  message: string,
  setAppState: (updater: (state: AppState) => AppState) => void,
): void
```
