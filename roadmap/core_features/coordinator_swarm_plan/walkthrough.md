# Coordinator Swarm Architecture (Phase 1)

I have successfully implemented Phase 1 of the Coordinator Mode Architecture for LiteAI, aligning it with the multi-agent swarm capabilities of Claude Code.

## Architectural Changes & Additions

### 1. Mode Detection & Flagging
- Added the `LITEAI_COORDINATOR_MODE` environment variable to the `Flag` namespace (`packages/core/src/flag/flag.ts`).
- Introduced the authoritative `coordinator-mode.ts` utility which handles mode resolution. This utility prioritizes the persisted `Session.Info.sessionMode` to ensure state consistency across session restarts, syncing any drift back to the environment variable.
- Hooked `sessionMode` into the `Session.create` API routes and the `createNext` session generator, officially persisting the mode state for new sessions.

### 2. The Coordinator System Prompt
- Created `packages/core/src/coordinator/coordinator-prompt.ts`, porting over the robust 350-line instruction prompt used in Claude Code.
- It instructs the Coordinator to act strictly as an orchestrator, removing its ability to directly read/write files and forcing it to spawn research/implementation subagents.
- The prompt dynamically injects available worker capabilities and MCP connections so the Coordinator knows what its agents can do.

### 3. Engine Wiring & Tool Filtering
- Updated the core engine query loop (`packages/core/src/session/engine/query.ts`) to intercept tool resolution.
- When `sessionMode` is "Coordinator", the system prompt is entirely overridden by the coordinator prompt.
- An explicit tool allowlist (`applyCoordinatorToolFilter`) forcefully restricts the Coordinator to a strict orchestration boundary (e.g., stripping out `read`, `write`, `grep`, etc., and only allowing `task`, `task_stop`, `team_create`, etc.).
- Integrated `isForkSubagentEnabled` gatekeeping in `agent/fork.ts`, keeping standard subagent forking disabled for the coordinator itself to enforce proper swarm dispatch routing.

### 4. Swarm Orchestration Tools
- Implemented three crucial new tools to support Phase 1 orchestration:
  - **`task_stop`**: Allows the coordinator to kill a long-running/errant background task gracefully via `SessionPrompt.cancel`.
  - **`team_create`**: Initializes a multi-agent team directory (`~/.liteai/teams/<name>`) and sets up `teamContext` tracking in the `AppState`.
  - **`team_delete`**: Gracefully tears down a team directory, throwing an error if any teammates are still actively running.
- Updated `packages/core/src/tool/registry.ts` to export the new tools into the system pool.

## Verification
- Wrote a dedicated suite of unit tests for the coordinator mode utilities (`test/coordinator/coordinator-mode.test.ts`).
- Addressed TypeScript configuration errors across multiple files, properly hooking into `AgentContext` session identifiers.
- Ran `bun typecheck` to verify complete type safety. Tests and types successfully passed.

This implementation lays the groundwork for Phase 2 (Mailbox IPC / Teammate communication), enabling LiteAI to operate autonomously across multi-agent boundaries.
