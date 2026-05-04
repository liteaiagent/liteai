# Research: Backward Execution & Step-Level Control

**Date**: 2026-05-04  
**Feature**: [spec.md](file:///d:/liteai/specs/011-backward-execution/spec.md)

## R1: Pause Mechanism — `await` Signal vs Return-and-Re-invoke

### Decision: `await`-based Promise gate within the existing `queryLoop` while(true)

### Rationale

The engine loop (`queryLoop` in `query.ts`) is an `AsyncGenerator<EngineEvent.Any>` consumed by `runSessionInner` in `loop.ts`. Two pause strategies were evaluated:

1. **Return-and-Re-invoke**: The loop returns on pause, and a new call to `runSession` re-enters. This requires serializing the full loop state (step counter, autocompact state, loop detection counters, plan mode state, compaction orchestrator) — all currently local variables in `queryLoop`.

2. **Await-based gate**: Insert a `Promise<void>` gate (a "latch") between iterations. When step mode is active, the loop pauses on the latch after yielding `turn-end`. When the user resumes, the latch resolves and the loop continues.

**The await approach is strictly superior** because:
- Zero serialization overhead — all local state (`step`, `loopDetector`, `autocompactState`, `stopDriftService`, `telemetryTracker`) survives the pause in closure scope.
- The `for await` loop in `runSessionInner` naturally blocks on the generator; no new control path needed.
- The AbortController already provides a cancellation channel; the pause latch is the second signal type on the same session.
- Matches LangGraph's `interrupt_before`/`interrupt_after` pattern where the Pregel loop throws `GraphInterrupt()` and awaits resume.

### Alternatives Considered

- **Return-and-re-invoke**: Rejected due to state serialization complexity and the risk of subtle bugs from incomplete state capture.
- **Bus event subscription**: Rejected — would introduce a pub/sub dependency into the hot loop, violating Phase 2's isolation guarantees.

---

## R2: Resume API — Entry Point Design

### Decision: HTTP endpoint + Bus event for internal signal delivery

### Rationale

The existing architecture uses HTTP endpoints in `server/routes/session.ts` for all session control (abort, fork, prompt). The resume API follows this pattern:

- **HTTP endpoint**: `POST /:sessionID/resume` — the frontend calls this to unpause.
- **Internal signal**: The endpoint resolves the pending pause latch via a `resolve()` call on the stored `SessionState` entry (same pattern as `cleanup()` / `cancel()`).
- **Guidance injection**: The resume endpoint accepts optional `parts` (text guidance) which are injected into `msgsBuffer.current` before the latch resolves.

This mirrors the existing `cancel()` function which calls `safeAbort()` — resume calls `latch.resolve()`.

### Alternatives Considered

- **Direct function call without HTTP**: Would require TUI/SDK to have in-process access to the latch — not viable for the HTTP/SSE architecture.
- **WebSocket upgrade**: Over-engineering — the SSE stream already provides server→client push for state changes.

---

## R3: Checkpoint Storage Strategy

### Decision: Full message list snapshots per checkpoint (initial), with snapshot hash reference for file state

### Rationale

The `msgsBuffer.current` array (type `Message.WithParts[]`) is already the authoritative in-memory state. Capturing it at step boundaries is a simple deep-copy. Delta compression adds significant complexity (tracking per-turn message diffs, handling compaction boundaries) for marginal storage savings in the typical case (sessions rarely exceed 50 steps).

The git tree hash from `Snapshot.track()` provides O(1) file state reference — no need to duplicate file contents.

### Alternatives Considered

- **Delta compression**: Deferred to future optimization. Each checkpoint stores only new messages since the prior checkpoint + a reference to the prior checkpoint. Adds complexity to restore (must walk the chain) without proportional benefit for typical session lengths.
- **Storing messages as JSON in a separate SQLite table**: Viable but introduces schema migration. The initial implementation stores checkpoints in-memory (same as `msgsBuffer`), with SQLite persistence as a follow-on.

---

## R4: Checkpoint Granularity

### Decision: Per-loop-iteration (one LLM call + tool execution cycle = one step = one checkpoint)

### Rationale

The `queryLoop` generator's `while(true)` loop body defines the natural step boundary: model resolution → tool resolution → turn-start → stream → turn-end. This is the atomic unit of work from the user's perspective ("the agent read files", "the agent wrote code").

Per-tool-call checkpointing would create excessive noise (a single step might invoke 5+ tools) and make step-back semantically confusing. Per-turn is identical to per-loop-iteration in this architecture.

LangGraph's Pregel loop uses the same granularity: one `tick()` = one checkpoint.

### Alternatives Considered

- **Per-tool-call**: Too granular — user doesn't think in terms of individual tool calls.
- **Per-user-message**: Too coarse — loses the ability to step back within a multi-step agent execution.

---

## R5: Subagent Interaction on Step-Back

### Decision: Non-revert with explicit user communication

### Rationale

Subagent sessions are independent process trees. Claude Code's `forkSubagent` model treats children as independent workers whose side-effects (file writes, commits) are their own responsibility. Automatically reverting child sessions would require:
1. Tracking all child session IDs spawned after a given checkpoint
2. Recursively reverting their file changes (which may overlap with parent changes)
3. Handling the case where child sessions are still running

This is prohibitively complex and error-prone. The pragmatic approach: step-back in the parent session reverts the parent's file state and truncates the parent's messages. The system informs the user that child sessions spawned after the target step still exist and lets the user decide (delete them, keep them, or manually revert).

### Alternatives Considered

- **Cascade revert**: Recursively revert all child sessions. Rejected due to complexity and the risk of data loss in long-running child sessions.
- **Orphan cleanup on fork**: Automatically mark child sessions as "orphaned" when the parent steps back. Viable as a future enhancement but not required for initial implementation.

---

## R6: Step Context Data Source

### Decision: Extend OpenTelemetry trace spans with checkpoint association, not separate data structure

### Rationale

The existing `TelemetryTracker` (in `telemetry.ts`) and OpenTelemetry spans already capture per-step:
- Agent name, model/provider (span attributes)
- System prompt content (via `SystemPrompt.resolveSystemPromptSections`)
- Tool schemas (via `resolveTools`)
- Timing (span start/end)
- Token usage (span attributes)

Creating a separate `StepContext` data structure would duplicate this information. Instead, the checkpoint should reference the trace span ID for that step, and the step context query resolves via the existing telemetry backend (Langfuse/OTLP).

For the initial implementation (before external telemetry is guaranteed), the checkpoint metadata captures a summary snapshot of the key context values (agent, model, step, timing).

### Alternatives Considered

- **Dedicated StepContext table**: Rejected — duplicates existing Trace data.
- **Inline in CheckpointData.metadata**: Chosen as the pragmatic middle ground — fast to query, no external dependency.

---

## R7: Conflict Detection on Step-Back

### Decision: Use `Snapshot.diff()` to detect external modifications before restoring

### Rationale

Before `Snapshot.restore(checkpoint.snapshot)` overwrites files, the system should:
1. Call `Snapshot.track()` to capture the current file state
2. Call `Snapshot.diff(currentHash)` vs `Snapshot.diff(checkpoint.snapshot)` to identify files that changed after the checkpoint AND were externally modified (not by the agent)
3. If conflicts exist, warn the user and require explicit confirmation

The git infrastructure for this already exists — `Snapshot.diff()` and `Snapshot.patch()` provide the primitives.

### Alternatives Considered

- **Unconditional restore**: Rejected — would silently overwrite user's manual edits.
- **Three-way merge**: Over-engineering for this use case — the user can manually resolve conflicts.
