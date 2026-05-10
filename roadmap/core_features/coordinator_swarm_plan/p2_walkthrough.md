# Phase 2: Coordinator Swarm Mailbox Implementation

## Overview
Successfully implemented the foundational **Mailbox IPC Protocol** for the LiteAI Coordinator Swarm architecture. This phase establishes the file-based, lock-guarded message routing system required for in-process teammates, bringing the system into full structural parity with the intended multi-tenant design.

## Implementation Details

### 1. File-Based Teammate Mailbox (`teammate-mailbox.ts`)
- **JSON Inbox Storage:** Implemented isolated JSON file storage for each teammate under `.liteai/teams/{teamName}/inboxes/{agentName}.json`.
- **Lock-Guarded Concurrency:** Integrated `proper-lockfile` to ensure safe, atomic multi-process appends when teammates and coordinators write to the same mailbox simultaneously.
  - *Note:* Configured `retries: 50` and `maxTimeout: 200` to prevent contention failures during high-volume broadcasts or test execution.
- **Data Primitives:** Provided a fully typed `TeammateMessage` interface containing `from`, `text`, `timestamp`, and `read` status.
- **Mailbox Operations:** Implemented functions for reading, unread filtering, marking as read (globally or by index), and full mailbox clearance.

### 2. Structured Swarm Messages (`swarm-messages.ts`)
- **Protocol Schemas:** Implemented strict `Zod` schemas for Phase 2 required IPC messages.
- **Message Types:**
  - `idle_notification`
  - `shutdown_request`
  - `shutdown_approved` / `shutdown_rejected`
  - `plan_approval_request` / `plan_approval_response` (Stubbed for future planning phase)
- **Validation Pipeline:** Provided type guards (`isShutdownRequest`, etc.) to securely parse and route messages from generic string tool inputs.

### 3. Agent Name Registry Wiring
- **Lifecycle Integration:** Hooked the global `AppState.agentNameRegistry` into `runAsyncAgentLifecycle` (`src/agent/lifecycle.ts`).
- **Automatic Resolution:** Subagents now register their generated IDs mapped to their user-friendly names upon spawn, and clean them up within the `finally` teardown block, enabling deterministic named-based routing.

### 4. `send_message` Tool Refactor
- **Unified Routing Strategy:** Completely refactored `send_message.ts` to implement a hybrid routing protocol:
  - **Broadcast Routing (`to: "*"`):** Iterates over active team members and pushes messages to all teammates simultaneously.
  - **Mailbox Routing:** Identifies teammate recipients via `teamContext` and delegates the payload to the file-based lock-guarded mailbox.
  - **Legacy Fallback:** Subagent routing remains intact for backward compatibility, automatically waking suspended tasks or queueing for active loops.
- **Structured IPC Dispatch:** Automatically intercepts JSON-structured payloads (like `shutdown_request`) and injects required UUIDs (`request_id`) before dropping them into the target mailbox.

## Validation Results
- **Type Safety:** 100% compliant. Run via `bun typecheck` natively on Windows.
- **Linting:** 100% compliant via `bun lint:fix`.
- **Test Suite (`test/coordinator`):** `47 pass, 0 fail`
  - Created isolated tests for `teammate-mailbox.ts` verifying concurrency safety and directory path resolutions.
  - Resolved `mock.module` global cache poisoning by rewriting tests to use unique namespaces instead of global directory mocks.
  - Verified `send_message.ts` routing integration via AppState inspections without relying on brittle module mocking.

## Next Phase
This concludes Phase 2. The system is now fully prepped for Phase 3: the `teammate-runner` polling loop, where agents will autonomously fetch these messages and respond using the implemented protocol schemas.
