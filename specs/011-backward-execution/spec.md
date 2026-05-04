# Feature Specification: Backward Execution & Step-Level Control

**Feature Branch**: `011-backward-execution`  
**Created**: 2026-05-04  
**Status**: Draft  
**Input**: User description: "Enable step-level control over the engine loop: pause between steps, inspect intermediate state, step back to a prior point, and re-execute with different parameters — creating an 'agent debugger'."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Step Pause & Inspect (Priority: P1)

A developer is using an AI agent to refactor a complex authentication module. The developer enables step mode before submitting the prompt. After the agent reads the relevant files (Step 1), the loop pauses automatically. The developer reviews the files the agent selected and confirms the agent identified the correct scope. The developer resumes execution. The agent writes changes (Step 2) and pauses again. The developer inspects the file diffs and determines the approach is sound. The developer resumes, the agent runs tests, and the session completes normally.

**Why this priority**: Step-pause-inspect is the foundational capability that all other features depend on. It provides the highest-value UX improvement identified in prior analysis — giving users real-time oversight of agent behavior without requiring the agent to finish its entire plan before the user can intervene.

**Independent Test**: Can be fully tested by submitting a prompt with step mode enabled and verifying the session pauses between iterations, shows intermediate state (messages, tool results), and resumes correctly when instructed.

**Acceptance Scenarios**:

1. **Given** a session with step mode enabled, **When** the agent completes a loop iteration (LLM call + tool execution), **Then** the session enters a "paused" state and the user can see all messages, tool calls, and results produced in that step.
2. **Given** a paused session, **When** the user issues a resume command, **Then** the loop continues from exactly where it left off, using the same in-memory state — no data is re-read or lost.
3. **Given** a paused session, **When** the user issues a resume command with additional guidance text, **Then** the guidance is injected into the conversation context before the next LLM call.
4. **Given** a session in step mode, **When** step mode is disabled mid-session, **Then** the loop continues without pausing until completion.

---

### User Story 2 - Step Back & Re-Execute (Priority: P2)

A developer is using an AI agent that has completed three steps of a task. At Step 3, the developer realizes the agent's approach at Step 2 was suboptimal. The developer issues a step-back command targeting Step 2's checkpoint. The system restores the file state (via the workspace snapshot captured at Step 2) and truncates the conversation to the messages that existed at that checkpoint. The developer provides new guidance ("Use a middleware pattern instead") and the agent re-executes from Step 2 with the adjusted context.

**Why this priority**: Step-back is the core "undo" capability that transforms the agent from a one-shot executor into a collaborative, iterative partner. It combines existing building blocks (snapshot restore, message truncation) into a single orchestrated operation, delivering disproportionate user value.

**Independent Test**: Can be fully tested by running a multi-step session, issuing a step-back to a prior checkpoint, verifying file state is restored and messages are truncated, then resuming and confirming the agent proceeds from the restored point.

**Acceptance Scenarios**:

1. **Given** a session with at least 3 completed steps and checkpoints, **When** the user issues a step-back to step 2, **Then** the workspace file state matches the snapshot captured at step 2's checkpoint.
2. **Given** a step-back has been performed, **When** the agent resumes, **Then** the conversation context contains only messages up to the target checkpoint, and no messages from subsequent steps are visible to the agent.
3. **Given** a step-back has been performed, **When** the user provides new guidance before resuming, **Then** the guidance appears in the conversation context immediately before the next agent turn.
4. **Given** a session with subagent spawns after the target step, **When** the user issues a step-back, **Then** the system clearly communicates to the user that child session state is not reverted and presents the user with options on how to handle orphaned child sessions.

---

### User Story 3 - Fork & Re-Execute with Different Parameters (Priority: P3)

A developer is reviewing a paused session and wants to explore an alternative approach without losing the current conversation. The developer issues a fork command targeting Step 2, specifying a different model for the next step. The system creates a new session branched from Step 2's checkpoint, with the new model configuration applied. Both the original session (paused at its current step) and the new forked session (starting from Step 2) are independently accessible.

**Why this priority**: Fork-and-re-execute combines step-back with session forking and parameter overrides. While highly valuable for exploratory workflows, it depends on both step-back (Story 2) and the existing session fork infrastructure, making it naturally the third priority.

**Independent Test**: Can be fully tested by running a session to step 3, forking at step 2 with a model override, and verifying that two independent sessions exist — the original still at step 3 and the fork starting from step 2 with the new model applied.

**Acceptance Scenarios**:

1. **Given** a session at step 3, **When** the user forks at step 2 with a model override, **Then** a new session is created with messages up to step 2 and the specified model is used for subsequent steps.
2. **Given** a forked session, **When** the fork completes, **Then** the original session remains unmodified and independently resumable.
3. **Given** a fork request, **When** the user specifies additional guidance along with the fork, **Then** the guidance is injected into the forked session's context before the first re-executed step.

---

### User Story 4 - Step Context Inspection (Priority: P4)

A developer is debugging a multi-step agent session and wants to understand what context the agent used at a specific step — which model was selected, what system prompt was active, and what tool schemas were available. The developer queries the step context for step 3 and receives a structured summary including agent name, model/provider, system prompt hash, tool schema hashes, message context IDs, and timing information.

**Why this priority**: Step context formalization provides the "debugger watch window" — critical for advanced debugging but not required for the primary pause/step-back/fork flows. It leverages the existing Trace system and adds queryability on top, making it a natural enhancement after the core features are in place.

**Independent Test**: Can be fully tested by running a multi-step session, then querying step context for a specific step and verifying the returned data matches the agent, model, and tools that were actually used at that step.

**Acceptance Scenarios**:

1. **Given** a completed multi-step session, **When** the user queries step context for step N, **Then** the system returns the agent name, model/provider, system prompt identifier, tool schema identifiers, and timing data for that step.
2. **Given** a step context query, **When** the checkpoint at that step has associated Trace data, **Then** the Trace data is surfaced as the metadata component of the checkpoint, not duplicated in a separate structure.

---

### Edge Cases

- What happens when the user issues step-back to step 1 (the very first step) — the system must handle restoring to the initial session state with no prior file changes.
- How does the system handle step-back when the agent has modified files that have also been externally modified since the checkpoint — the system must detect conflicts and warn the user.
- What happens when a step-back targets a checkpoint that involved subagent execution — the system must communicate that subagent side-effects (file writes in child sessions) are not automatically reverted.
- How does the system handle pausing during an active tool execution (e.g., a long-running shell command) — the pause should occur at step boundaries, not mid-tool-call.
- What happens when the user forks a session that was itself forked — the system must support multi-level branching without data corruption.
- How does the system handle step-back when checkpoint storage limits are exceeded — older checkpoints may have been compacted or evicted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support a "step mode" that pauses execution between loop iterations (after each LLM response + tool execution cycle).
- **FR-002**: System MUST expose the current step's intermediate state (messages, tool calls, tool results, file changes) to the user during a pause.
- **FR-003**: System MUST support resuming a paused session, continuing from the exact in-memory state without re-reading persisted data.
- **FR-004**: System MUST support injecting user guidance text into the conversation context when resuming a paused session.
- **FR-005**: System MUST support toggling step mode on and off during an active session.
- **FR-006**: System MUST capture checkpoint data at step boundaries, including conversation messages, workspace file state reference, step number, and contextual metadata.
- **FR-007**: System MUST support step-back to a prior checkpoint, restoring workspace file state and truncating conversation history to that point.
- **FR-008**: System MUST support re-entering the loop from a restored checkpoint with optional new user guidance.
- **FR-009**: System MUST support forking a session at a specific checkpoint, creating an independent new session branched from that point.
- **FR-010**: System MUST support parameter overrides (model, agent) when forking a session.
- **FR-011**: System MUST provide queryable step context data that surfaces per-step metadata (agent, model, system prompt, tools, timing) from the existing trace infrastructure.
- **FR-012**: System MUST maintain checkpoint-to-trace data association without duplicating trace information into checkpoint storage.
- **FR-013**: System MUST handle step-back with subagent sessions by communicating the scope of revert to the user and not silently discarding child session state.
- **FR-014**: System MUST detect and warn the user when a step-back would conflict with externally modified files.
- **FR-015**: System MUST enforce step-boundary pausing — pauses occur after a full iteration, never mid-tool-execution.

### Key Entities

- **Checkpoint**: A snapshot of the session's state at a step boundary, including a reference to conversation messages, workspace file state, step number, parent checkpoint reference, session identity, and contextual metadata (agent, model, trigger type). Checkpoints form a linked chain via parent references.
- **Step**: A single iteration of the engine loop, encompassing one LLM call and its resulting tool executions. Steps are numbered sequentially within a session.
- **StepContext**: The queryable metadata associated with a step, derived from the existing Trace system. Includes agent name, model/provider, system prompt identifier, tool schema identifiers, message context IDs, and timing information.
- **SessionFork**: A new session created by branching from a specific checkpoint. Inherits the conversation and file state at the fork point but operates independently thereafter.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can pause, inspect, and resume an agent session within 1 second of issuing the command — step transitions must feel instant.
- **SC-002**: Step-back restores the session to a prior state within 5 seconds, including workspace file restoration, for sessions with up to 50 steps.
- **SC-003**: Forked sessions are independently operable within 3 seconds of the fork command.
- **SC-004**: 100% of step-back operations produce a session state that is indistinguishable from having originally run the session up to only that step — no orphaned state, no leaked messages, no phantom file changes.
- **SC-005**: Step context queries return complete metadata for any step within 500 milliseconds.
- **SC-006**: Users who enable step mode report at least 80% satisfaction with the level of control over agent behavior, measured via post-session feedback.
- **SC-007**: The step-pause mechanism does not introduce measurable latency (>100ms) to the normal (non-step-mode) execution path.

## Assumptions

- Phase 1 (Checkpointer Interface) and Phase 2 (Self-Contained Loop) from the engine-loop-decoupling roadmap are completed before this feature begins implementation. The loop owns its state in memory and does not re-read from the database during iteration.
- The existing Snapshot system (git tree hash capture/restore) is functional and reliable for workspace file state management.
- The existing Trace system captures sufficient per-step metadata (agent, model, system prompt, tools, timing) and can be extended to support queryable access without structural redesign.
- The existing `Session.fork()` infrastructure (message copy at a boundary) is functional and can be extended to support checkpoint-based forking.
- Checkpoint storage overhead is acceptable — full message list snapshots per checkpoint are used initially, with delta compression deferred to a future optimization pass.
- Subagent sessions are NOT automatically reverted during step-back. The user is informed and given manual control over child session cleanup.
- Multi-level forking (forking a forked session) is supported but presents a flat list of sessions to the user — tree visualization of fork branches is deferred.
- Step mode is per-session — enabling it on one session does not affect other concurrent sessions on the same tenant.
