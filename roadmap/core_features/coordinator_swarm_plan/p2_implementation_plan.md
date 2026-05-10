# Phase 2: SendMessage + Mailbox Protocol

> **Roadmap:** [plan_progress_tracking.md](file:///d:/liteai/roadmap/core_features/coordinator_swarm_plan/plan_progress_tracking.md)  
> **Reference:** [D:\claude-code\src](file:///D:/claude-code/src)  
> **Prerequisite:** Phase 1 ✅ (Coordinator Mode State Machine + System Prompt)

---

## Goal

Implement the file-based teammate mailbox IPC protocol, structured swarm message schemas, agent name registry population, and broadcast routing. This bridges the gap between Phase 1's coordinator scaffolding (tools, system prompt, mode gating) and Phase 3's in-process teammate runner by establishing the durable communication layer that teammates and the coordinator use to exchange messages asynchronously.

## Summary of Current State

**What LiteAI already has (from Phase 1):**
- `send_message.ts` with `routeMessage()`, `queuePendingMessage()`, name resolution via `agentNameRegistry`
- `resume.ts` with full agent resume infrastructure (sidechain subsessions, transcript reconstruction)
- `team-helpers.ts` with `TeamFile`, team directory management, `inboxes/` dir already created in `writeTeamFile()`
- `AppState` with `agentNameRegistry`, `tasks`, `teamContext`
- `coordinator-mode.ts` with tool filtering, user context generation

**What is missing (Phase 2 scope):**
1. `agentNameRegistry` is declared in `AppState` but **never populated**
2. **No teammate mailbox implementation** — file-based lock-guarded message queues
3. **No structured swarm message schemas** — discriminated union types for internal comms
4. **No broadcast routing** — `send_message.ts` cannot handle `to: "*"`
5. **No mailbox-based teammate routing** — `send_message.ts` only does in-memory queue + resume

---

## Architecture Decisions

### AD-1: Message Routing Strategy — Unified vs. Hybrid

| Approach | Pros | Cons |
|----------|------|------|
| **A: Unified file-based mailbox for all agents** | Single codepath, consistent behavior | Unnecessary file I/O for in-process subagents that share memory, breaks existing `queuePendingMessage` + resume flow |
| **B: Hybrid — file-based for teammates, in-memory for subagents** | Backwards-compatible, optimal performance per context type, matches Claude Code's routing strategy | Two codepaths to maintain |

**Decision: B — Hybrid routing.**

This mirrors Claude Code's [SendMessageTool.ts](file:///D:/claude-code/src/tools/SendMessageTool/SendMessageTool.ts#L800-L873) which first checks in-process subagents via `AppState.tasks`, then falls through to file-based mailbox routing for ambient teammates. LiteAI's existing `routeMessage()` already handles the subagent path — Phase 2 adds the teammate mailbox as a secondary routing target.

### AD-2: File Locking Strategy — Advisory Locks vs. Atomic Rename

| Approach | Pros | Cons |
|----------|------|------|
| **A: `proper-lockfile` npm package** | Battle-tested, retry with backoff, cross-platform, used by Claude Code | External dependency, 5KB footprint |
| **B: Atomic rename pattern** (write to `.tmp`, rename over target) | Zero dependencies | No concurrent-reader safety, rename is not atomic on Windows NTFS under all conditions |
| **C: Custom lock via `fs.writeFile` with `wx` flag** | Zero dependencies, works on Bun | Requires manual retry/backoff implementation, no stale lock detection |

**Decision: A — `proper-lockfile`.**

Claude Code's [teammateMailbox.ts](file:///D:/claude-code/src/utils/teammateMailbox.ts#L31-L41) uses this exact pattern with `retries: 10, minTimeout: 5, maxTimeout: 100`. The package is lightweight and handles stale lock detection. We'll add it to `packages/core` devDependencies.

> [!IMPORTANT]
> Must verify `proper-lockfile` compatibility with Bun's file system APIs before committing to this approach. If incompatible, fall back to Approach C with a custom retry wrapper.

### AD-3: Structured Message Scope — Full Taxonomy vs. Phase-Gated

| Approach | Pros | Cons |
|----------|------|------|
| **A: Implement full Claude Code message taxonomy** (~12 message types) | Complete parity, no future refactoring | 60%+ of types have no consumers until Phase 3/4, dead code |
| **B: Phase-gated — core transport + shutdown/idle only** | Minimal surface area, YAGNI-compliant, types only built when consumers exist | Future phases must extend the union |

**Decision: B — Phase-gated.**

Phase 2 implements only the message types that have immediate consumers:
- `idle_notification` — needed for Phase 3 in-process runner idle detection
- `shutdown_request` / `shutdown_approved` / `shutdown_rejected` — needed for graceful teammate lifecycle
- `plan_approval_request` / `plan_approval_response` — **type stubs only** (schema + type guard, no handler logic)

Permission messages (`permission_request/response`, `sandbox_permission_*`, `team_permission_update`, `mode_set_request`) are explicitly Phase 4 scope.

### AD-4: Agent Name Registry Population — Lifecycle Hook vs. Tool-Side Registration

| Approach | Pros | Cons |
|----------|------|------|
| **A: Register in `runAsyncAgentLifecycle`** | Centralized, catches all async agent spawns (task tool, resume, etc.) | Requires `description` param to be threaded through |
| **B: Register in `TaskTool.execute` and `resumeAgentBackground`** | Direct access to agent name at spawn/resume site | Fragile — any new spawn path must remember to register |

**Decision: A — Lifecycle hook.**

Registration happens in [lifecycle.ts](file:///d:/liteai/packages/core/src/agent/lifecycle.ts#L359-L460) `runAsyncAgentLifecycle` at the start of the lifecycle (before `runAgentImpl()`). Deregistration happens in the `finally` block. This ensures every async agent is registered regardless of spawn path.

---

## Proposed Changes

### Component 1: Teammate Mailbox (New Module)

#### [NEW] [teammate-mailbox.ts](file:///d:/liteai/packages/core/src/coordinator/teammate-mailbox.ts)

File-based lock-guarded message queue system (~350 lines). Adapted from Claude Code's [teammateMailbox.ts](file:///D:/claude-code/src/utils/teammateMailbox.ts) with multi-tenant adaptations:

**Types:**
```typescript
export interface TeammateMessage {
  from: string
  text: string
  timestamp: string
  read: boolean
  color?: string
  summary?: string
}
```

**Core Functions:**
| Function | Purpose |
|----------|---------|
| `getInboxPath(agentName, teamName)` | Returns `~/.liteai/teams/{team}/inboxes/{name}.json` |
| `ensureInboxDir(teamName)` | Creates `inboxes/` directory if missing |
| `readMailbox(agentName, teamName)` | Read all messages from inbox JSON file |
| `readUnreadMessages(agentName, teamName)` | Filter to unread messages only |
| `writeToMailbox(recipientName, message, teamName)` | Lock → read → append → write → unlock |
| `markMessagesAsRead(agentName, teamName)` | Mark all messages as read (bulk) |
| `markMessageAsReadByIndex(agentName, teamName, index)` | Mark single message by index |
| `clearMailbox(agentName, teamName)` | Truncate inbox to `[]` |
| `formatTeammateMessages(messages)` | Format as XML `<teammate-message>` blocks for SSE delivery |

**Multi-tenant adaptations vs. Claude Code:**
- Team name passed as explicit parameter (not from `process.env`)
- Inbox paths use `Global.Path.root` (session-scoped root) instead of `getTeamsDir()` global
- All functions are `async` (no sync variants needed — LiteAI has no React render path)

---

### Component 2: Structured Swarm Messages (New Module)

#### [NEW] [swarm-messages.ts](file:///d:/liteai/packages/core/src/coordinator/swarm-messages.ts)

Zod-validated message schemas and type guards (~200 lines). Adapted from Claude Code's [teammateMailbox.ts L394-L1095](file:///D:/claude-code/src/utils/teammateMailbox.ts#L394-L1095):

**Message Types (Phase 2 scope):**

| Type | Direction | Purpose |
|------|-----------|---------|
| `IdleNotificationMessage` | teammate → leader | Teammate went idle (available, interrupted, failed) |
| `ShutdownRequestMessage` | leader → teammate | Graceful shutdown request with optional reason |
| `ShutdownApprovedMessage` | teammate → leader | Teammate acknowledges shutdown |
| `ShutdownRejectedMessage` | teammate → leader | Teammate rejects shutdown with reason |
| `PlanApprovalRequestMessage` | teammate → leader | Type stub for Phase 3 |
| `PlanApprovalResponseMessage` | leader → teammate | Type stub for Phase 3 |

**Utility Functions:**
| Function | Purpose |
|----------|---------|
| `createIdleNotification(agentId, options?)` | Factory for idle notification messages |
| `createShutdownRequestMessage(params)` | Factory for shutdown request |
| `createShutdownApprovedMessage(params)` | Factory for shutdown approval |
| `createShutdownRejectedMessage(params)` | Factory for shutdown rejection |
| `isIdleNotification(text)` | Type guard — parse JSON and validate |
| `isShutdownRequest(text)` | Type guard — Zod safeParse |
| `isShutdownApproved(text)` | Type guard — Zod safeParse |
| `isShutdownRejected(text)` | Type guard — Zod safeParse |
| `isPlanApprovalRequest(text)` | Type guard stub |
| `isPlanApprovalResponse(text)` | Type guard stub |
| `isStructuredProtocolMessage(text)` | Returns true if text is any recognized protocol message |

---

### Component 3: Send Message Tool Upgrade

#### [MODIFY] [send_message.ts](file:///d:/liteai/packages/core/src/tool/send_message.ts)

Major refactor to add structured messages, broadcast, and mailbox routing (~250 lines modified):

**Schema changes:**
```typescript
// Current: z.object({ to: z.string(), message: z.string() })
// New:
const StructuredMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shutdown_request'), reason: z.string().optional() }),
  z.object({ type: z.literal('shutdown_response'), request_id: z.string(), approve: z.boolean(), reason: z.string().optional() }),
  z.object({ type: z.literal('plan_approval_response'), request_id: z.string(), approve: z.boolean(), feedback: z.string().optional() }),
])

const parameters = z.object({
  to: z.string().describe('Recipient: teammate name, or "*" for broadcast to all teammates'),
  summary: z.string().optional().describe('A 5-10 word summary shown as preview in the UI'),
  message: z.union([z.string(), StructuredMessage]),
})
```

**Routing logic refactor:**
1. **Broadcast path** (`to: "*"`): Read team file members, iterate all non-self members, `writeToMailbox()` for each
2. **Subagent path** (existing): Check `appState.tasks` → queue if running, resume if stopped
3. **Teammate mailbox path** (new): Check if recipient is a teammate via `appState.teamContext?.teammates` → `writeToMailbox()`
4. **Structured message handlers**: `handleShutdownRequest()`, `handleShutdownApproval()`, `handleShutdownRejection()`, `handlePlanApproval()`

**Return types:**
```typescript
export type MessageOutput = { success: boolean; message: string; routing?: MessageRouting }
export type BroadcastOutput = { success: boolean; message: string; recipients: string[] }
export type RequestOutput = { success: boolean; message: string; request_id: string; target: string }
```

---

### Component 4: Agent Name Registry Population

#### [MODIFY] [lifecycle.ts](file:///d:/liteai/packages/core/src/agent/lifecycle.ts)

Wire agent name → agentId registration into the async agent lifecycle:

```typescript
// In runAsyncAgentLifecycle(), before runAgentImpl():
const effectiveDeps = summarizationDeps ?? options?.summarizationDeps
const rootSetAppState = effectiveDeps?.setAppStateForTasks

if (rootSetAppState) {
  rootSetAppState((state) => ({
    ...state,
    agentNameRegistry: {
      ...state.agentNameRegistry,
      [agentName]: agentId,
    },
  }))
}

// In the finally block, after enqueueAgentNotification:
if (rootSetAppState) {
  rootSetAppState((state) => {
    const registry = { ...state.agentNameRegistry }
    if (registry[agentName] === agentId) {
      delete registry[agentName]
    }
    return { ...state, agentNameRegistry: registry }
  })
}
```

> [!WARNING]
> Agent name collisions: If two agents share the same `agentName`, the second registration overwrites the first. This is acceptable for Phase 2 because the coordinator system prompt explicitly directs the LLM to use unique task descriptions. Phase 3 may need a `Map<string, string[]>` for multi-instance agents.

---

### Component 5: Barrel Export and Team Helpers Updates

#### [MODIFY] [index.ts](file:///d:/liteai/packages/core/src/coordinator/index.ts)

Add exports for new modules:
```typescript
export * from "./teammate-mailbox"
export * from "./swarm-messages"
```

#### [MODIFY] [team-helpers.ts](file:///d:/liteai/packages/core/src/coordinator/team-helpers.ts)

Add `TeamMember.color` to the interface (already in `AppState.teamContext.teammates` but missing from disk `TeamMember`):
```typescript
export interface TeamMember {
  agentId: string
  name: string
  agentType: string
  joinedAt: number
  cwd: string
  color?: string   // NEW: teammate color for UI display
  isActive?: boolean
}
```

---

### Component 6: Tests

#### [NEW] [teammate-mailbox.test.ts](file:///d:/liteai/packages/core/test/coordinator/teammate-mailbox.test.ts)

~250 lines covering:
- `writeToMailbox` + `readMailbox` roundtrip
- `readUnreadMessages` filtering
- `markMessagesAsRead` / `markMessageAsReadByIndex`
- `clearMailbox`
- `getInboxPath` path sanitization (team name + agent name)
- `formatTeammateMessages` XML output
- Concurrent write safety (parallel `writeToMailbox` calls)
- ENOENT graceful handling (read from nonexistent inbox)

#### [NEW] [swarm-messages.test.ts](file:///d:/liteai/packages/core/test/coordinator/swarm-messages.test.ts)

~150 lines covering:
- Message creation factories (all types)
- Type guard parsing (valid JSON → correct type, invalid → null)
- `isStructuredProtocolMessage` (true for all known types, false for plain text)
- Malformed JSON handling

#### [MODIFY] [send-message.test.ts](file:///d:/liteai/packages/core/test/coordinator/send-message.test.ts) (or new file)

~200 lines covering:
- Broadcast routing (`to: "*"`) writes to all teammate inboxes
- Structured shutdown_request serialization/deserialization
- Subagent routing still works (regression)
- Teammate mailbox routing (new path)
- Input validation (empty `to`, structured broadcast rejection)

---

### Component 7: Dependency Addition

#### [MODIFY] [package.json](file:///d:/liteai/packages/core/package.json)

Add `proper-lockfile` dependency:
```json
{
  "dependencies": {
    "proper-lockfile": "^4.1.2"
  },
  "devDependencies": {
    "@types/proper-lockfile": "^4.1.4"
  }
}
```

> [!IMPORTANT]
> **Bun compatibility check required.** Before committing to `proper-lockfile`, run a quick smoke test:
> ```typescript
> import * as lockfile from "proper-lockfile"
> const release = await lockfile.lock("test.json", { retries: { retries: 3 } })
> await release()
> ```
> If this fails under Bun, we'll implement a custom lock using `fs.writeFile` with `wx` flag + retry loop.

---

## Open Questions

> [!IMPORTANT]
> **Q1: `proper-lockfile` Bun Compatibility**  
> The reference implementation uses `proper-lockfile` for inbox file locking. This package uses `graceful-fs` and `retry` internally. Need to verify these work correctly under Bun's Node.js compatibility layer. Fallback: custom lock implementation using `fs.writeFile({ flag: 'wx' })` + exponential retry.

> [!NOTE]  
> **Q2: Message Retention Policy**  
> Claude Code's inboxes grow unbounded — messages accumulate until `clearMailbox()` is called (team delete). For LiteAI's multi-tenant context with potentially long-running sessions, should we add a max inbox size (e.g., 1000 messages) with oldest-first eviction? Or is the current approach (clear on team delete) sufficient for Phase 2?

---

## Verification Plan

### Automated Tests
```bash
bun test test/coordinator/teammate-mailbox.test.ts
bun test test/coordinator/swarm-messages.test.ts
bun test test/coordinator/send-message.test.ts
bun test test/coordinator  # full coordinator suite (regression)
bun typecheck
bun lint:fix
```

### Manual Verification
1. **Mailbox roundtrip**: Write a message via `writeToMailbox()`, verify JSON file exists in `~/.liteai/teams/{team}/inboxes/`, read back via `readMailbox()`
2. **Broadcast**: Create a team with 3 members, send broadcast (`to: "*"`), verify all 3 inbox files have the message
3. **Structured message**: Send `shutdown_request` via `send_message` tool, verify JSON structure in recipient's inbox
4. **Agent name registry**: Spawn a task agent, verify `agentNameRegistry` is populated, send message by name, verify routing resolves to correct agentId
5. **Regression**: Existing `send_message` → running subagent → queues correctly (no behavioral change)

---

## File Change Summary

| File | Action | Estimated LOC |
|------|--------|---------------|
| `src/coordinator/teammate-mailbox.ts` | NEW | ~350 |
| `src/coordinator/swarm-messages.ts` | NEW | ~200 |
| `src/tool/send_message.ts` | MODIFY (major) | ~250 modified |
| `src/agent/lifecycle.ts` | MODIFY (minor) | ~20 added |
| `src/coordinator/index.ts` | MODIFY (minor) | ~3 added |
| `src/coordinator/team-helpers.ts` | MODIFY (minor) | ~1 added |
| `test/coordinator/teammate-mailbox.test.ts` | NEW | ~250 |
| `test/coordinator/swarm-messages.test.ts` | NEW | ~150 |
| `test/coordinator/send-message.test.ts` | NEW | ~200 |
| `packages/core/package.json` | MODIFY | ~2 added |
| **Total** | | **~1,426** |
