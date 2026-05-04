# Feature Specification: Engine Loop Decoupling

**Feature Branch**: `engine-loop-decoupling`  
**Created**: 2026-05-04  
**Status**: Draft  
**Input**: User description: "Decouple the engine execution loop from direct database dependency by introducing a pluggable checkpointer interface, making the loop a forward-only state machine that returns typed results, and establishing explicit event fan-out with tracked async safety."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Engine Runs Without a Database (Priority: P1)

A developer integrating the LiteAI engine wants to run a session loop using only an in-memory persistence layer (or no persistence at all) so they can unit-test agent behavior without standing up SQLite infrastructure.

**Why this priority**: This is the foundational architectural guarantee. If the loop cannot function without a concrete database, every downstream feature (forward-only execution, event fan-out, eventual open-source extraction to `@liteagent/loop`) is blocked. It also unblocks the project's testing story — currently all engine tests require SQLite.

**Independent Test**: Can be fully tested by running a session loop with a `MemoryCheckpointer` and verifying it produces a correct assistant response without any database file being created or read.

**Acceptance Scenarios**:

1. **Given** the engine is configured with a `MemoryCheckpointer`, **When** a user prompt is submitted and the model responds, **Then** the loop completes successfully, returns a typed result containing the assistant message and its parts, and no SQLite database operations are invoked.
2. **Given** the engine is configured with a `NoopCheckpointer`, **When** a user prompt is submitted and the model responds, **Then** the loop completes and returns the assistant message, but no conversation history is persisted anywhere.
3. **Given** the engine is configured with a `SqliteCheckpointer` (the existing behavior), **When** a user prompt is submitted, **Then** the loop behaves identically to today — messages and parts are persisted to SQLite, and the session is recoverable after a crash.

---

### User Story 2 - Loop Returns Results Directly (Priority: P1)

An operator running the LiteAI backend expects that when a model resolution error occurs (e.g., misconfigured provider), the system produces a single, clean error notification without crashing and without requiring a database re-read to determine the outcome.

**Why this priority**: This directly addresses the root cause of the model-resolution crash incident. The current loop re-queries the DB to find its own output, crashing with `Error: Impossible` when no assistant message was created. Returning a typed result eliminates this entire class of failure.

**Independent Test**: Configure a non-existent model, submit a prompt, and verify: (a) one error toast appears in the TUI, (b) session transitions to idle, (c) `/new` works, (d) zero process crashes, (e) zero unhandled promise rejections.

**Acceptance Scenarios**:

1. **Given** the engine loop is processing a session, **When** `runSession` completes successfully, **Then** it returns a typed result with status `ok` containing the completed assistant message and all associated parts — without the caller needing to re-read from any external storage.
2. **Given** the engine loop is processing a session, **When** model resolution fails (provider error, invalid model ID, network timeout), **Then** `runSession` returns a typed result with status `error` containing the error object and an optional partial message — the caller never encounters `Error: Impossible`.
3. **Given** the engine loop is processing a session, **When** the user aborts the session mid-stream, **Then** `runSession` returns a typed result with status `aborted` and the caller handles cleanup without needing to inspect database state.

---

### User Story 3 - Error Propagation Without Side Effects (Priority: P1)

A developer debugging a failing session expects that error notification (publishing error events to subscribers) is the responsibility of the caller, not the internal generator — so errors surface in exactly one place with a clear, traceable call stack.

**Why this priority**: The current model mixes error propagation with side-effect notification inside `.catch()` handlers, creating untraceable detached promises via `Database.effect`. This causes duplicate error toasts, unhandled promise rejections, and debugging dead-ends. Separating these concerns is required for the system to meet the project's Fail-Fast Protocol mandate.

**Independent Test**: Trigger a model resolution failure and verify that the error appears in exactly one event consumer, with a complete stack trace, and zero detached `Database.effect` promises in the process.

**Acceptance Scenarios**:

1. **Given** an error occurs during the model resolution phase inside the loop generator, **When** the generator catches the error, **Then** it propagates the error through the return value — it does NOT publish any Bus events or invoke any side-effects itself.
2. **Given** `runSession` returns an error result, **When** the loop orchestrator receives the result, **Then** it publishes the error notification to the appropriate event channel exactly once, and the publish call is tracked (not fire-and-forget).

---

### User Story 4 - Multiple Independent Event Consumers (Priority: P2)

An operator running a multi-tenant LiteAI instance wants the SSE transport (streaming events to clients) and the persistence layer (writing to the database) to operate as independent consumers — so that a slow or failing SSE connection does not block persistence, and a persistence failure does not silently kill the SSE stream.

**Why this priority**: This is the structural enabler for async safety. The current single-pipeline model serializes checkpointing and SSE through the same code path, causing mutual interference and untraceable unhandled rejections.

**Independent Test**: Simulate a slow SSE consumer (delayed `writeSSE`) while the checkpointer is running. Verify that persistence completes on time regardless of SSE latency, and that the SSE transport error is surfaced without killing the session.

**Acceptance Scenarios**:

1. **Given** the engine loop produces an event, **When** the event is emitted, **Then** it is delivered independently to all registered event consumers (persistence, SSE transport, optional telemetry) via fan-out — failure in one consumer does not prevent delivery to others.
2. **Given** an SSE transport error occurs mid-stream (e.g., client disconnect), **When** the fan-out delivers the event to the SSE consumer, **Then** the error is captured and tracked via the promise tracker — it does NOT become an unhandled rejection and it does NOT block the checkpointer.
3. **Given** the engine loop completes or is aborted, **When** cleanup runs, **Then** all tracked promises from all event consumers are awaited and their errors are surfaced in a structured format before session resources are released.

---

### User Story 5 - Checkpointer Swappable at Runtime (Priority: P2)

A platform developer extending LiteAI wants to implement a custom persistence backend (e.g., PostgreSQL, a cloud-hosted store) by implementing a well-defined interface — without modifying any engine loop code.

**Why this priority**: This is the extensibility story that enables the eventual `@liteagent/loop` extraction and community-contributed checkpointer implementations.

**Independent Test**: Implement a trivial `TestCheckpointer` that records all method calls into an array, run a session with it, and verify the call sequence matches expectations (saveMessage → savePart* → updateMessage → dispose).

**Acceptance Scenarios**:

1. **Given** a class implements the checkpointer interface with the required methods (save message, save part, update message, load history, dispose), **When** the engine loop is configured to use this implementation, **Then** the loop functions correctly and delegates all persistence operations through the interface — no direct database calls bypass it.
2. **Given** a checkpointer implementation throws an error during `savePart`, **When** the engine loop encounters the error, **Then** the error is tracked via the promise tracker and surfaced during cleanup — it does NOT silently swallow the failure.

---

### Edge Cases

- What happens when the checkpointer's `dispose()` throws during cleanup? The session must still transition to idle and release all resources — the disposal error is logged and surfaced but does not leave the session in a stuck state.
- What happens when two event consumers both fail during the same event? Both errors must be captured independently and surfaced during cleanup — one consumer's failure must not mask the other's.
- What happens when a session is aborted while a checkpointer write is in-flight? The tracked promise must be awaited (with a timeout) during cleanup — no orphaned writes should exist after session teardown.
- What happens when `loadHistory` returns an empty history (new session)? The loop must function correctly with an empty initial message buffer — this is the normal case for new sessions.
- What happens when `loadHistory` encounters a corrupt or partial record? The checkpointer implementation is responsible for handling corrupt data (skipping malformed entries, logging warnings) — the loop receives only valid messages.
- What happens when the process crashes mid-write? Crash recovery granularity is determined by the checkpointer implementation. For SQLite, recovery is at the message/part boundary (same as today). For memory, state is lost. For file-based, recovery depends on the write durability of the filesystem.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define an abstract checkpointer interface that encapsulates all persistence operations (save message, save part, update message, load history, dispose).
- **FR-002**: The system MUST provide a `SqliteCheckpointer` implementation that preserves the exact current persistence behavior — zero behavioral regression from today's `EventPersister` + `AsyncPersistenceWriter` path.
- **FR-003**: The system MUST provide a `MemoryCheckpointer` implementation that stores messages and parts in memory, enabling database-free engine testing.
- **FR-004**: The system MUST provide a `NoopCheckpointer` implementation that accepts and discards all persistence operations, enabling ephemeral sessions.
- **FR-005**: The engine loop MUST be a forward-only state machine — during forward execution (from initial state to result), it MUST NOT read from external storage. All state needed for forward execution MUST be held in-memory.
- **FR-006**: The `runSession` function MUST return a typed result (`ok` with message, `error` with error and optional partial message, or `aborted`) — the caller MUST NOT need to re-query external storage to determine the outcome.
- **FR-007**: The engine loop MUST eliminate the current `Message.stream(sessionID)` re-query after `runSession` completes.
- **FR-008**: The engine loop MUST eliminate the `throw new Error("Impossible")` crash guard.
- **FR-009**: The loop generator MUST NOT publish Bus events or invoke side-effects during error handling — error propagation and error notification MUST be separate concerns.
- **FR-010**: The system MUST implement explicit event fan-out where each engine event is independently delivered to multiple event consumers (checkpointer, SSE transport, optional telemetry).
- **FR-011**: All async work spawned during the loop (checkpointer writes, Bus publishes, SSE writes) MUST be tracked via a promise tracker and awaitable during cleanup.
- **FR-012**: The system MUST NOT use `Database.effect()` for fire-and-forget Bus publishes inside the engine loop — all Bus publishes from the engine MUST be tracked.
- **FR-013**: The event classification logic (determining event type: text delta, tool call, error, etc.) MUST be separated from the persistence logic — the classifier does not write to storage, the checkpointer does not classify events.
- **FR-014**: Initial session state (message history) MUST be loaded through the checkpointer interface at loop initialization, not through direct database queries within the generator.
- **FR-015**: The checkpointer interface MUST be optional — the loop MUST function correctly when no checkpointer is provided (ephemeral mode, equivalent to `NoopCheckpointer`).

### Key Entities

- **Checkpointer**: The abstract persistence interface. Responsible for saving messages, parts, and session metadata. Loaded at loop initialization to provide history. Disposed at cleanup. Storage-agnostic — implementations determine durability guarantees.
- **EventConsumer** *(deferred)*: A formal interface for receiving engine events may be introduced when a third consumer is needed (e.g., telemetry). For this phase, the checkpointer and SSE transport are wired directly through `PromiseTracker.track()` — same isolation guarantees, less indirection. See FR-010.
- **PromiseTracker**: A tracked set of async promises spawned during loop execution. Ensures all async side-effects complete (or surface errors) before session resources are released.
- **SessionResult**: A typed discriminated union representing the outcome of a session loop execution — `ok`, `error`, or `aborted`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The engine loop can complete a full session (prompt → assistant response with tool calls → final response) using only the in-memory checkpointer — zero database file operations occur.
- **SC-002**: Model resolution failures produce exactly one error notification to the client, the session transitions to idle within 1 second, and zero unhandled promise rejections are logged.
- **SC-003**: All existing session tests pass without modification when using the `SqliteCheckpointer` — zero behavioral regression.
- **SC-004**: After loop cleanup completes, zero tracked promises remain pending — all async side-effects have been resolved or their errors surfaced.
- **SC-005**: The event fan-out delivers events to all registered consumers — a failure in one consumer does not prevent delivery to others and does not produce unhandled rejections.
- **SC-006**: The code path from event emission to persistence contains zero direct `Session.updateMessage()` or `Session.updatePart()` calls — all persistence goes through the checkpointer interface.

## Assumptions

- The existing `EventPersister` event classification logic is correct and does not need redesign — only its persistence coupling needs extraction.
- The `AsyncPersistenceWriter` batching strategy is sound and will be preserved as an internal implementation detail of `SqliteCheckpointer`.
- Compaction (`CompactionOrchestrator`) is out of scope for this spec — it operates on `msgsBuffer` and will be migrated to checkpointer ops in a follow-up spec. Its current direct DB calls are tolerated during this phase.
- Subagent result flow (Phase 4) is out of scope — subagent delegation will continue to use DB-mediated communication until a dedicated spec addresses it.
- Backward execution / step-back / replay (Phase 5) is out of scope — the checkpointer interface designed here will be extended in a future spec to support checkpoint-based resume.
- The `PlanModeStateRef` remains a separate, non-checkpointed session lifecycle concern — it is not part of the checkpointer's state.
- The `SidechainTranscript` system remains independent of the checkpointer — transcript and checkpointer serve different purposes (audit trail vs. crash recovery).
- The `processSubtask()` function's 14 direct DB writes will be migrated to checkpointer ops as part of this work — this is the largest single migration task.
