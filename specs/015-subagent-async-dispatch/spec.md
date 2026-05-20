# Feature Specification: Async Subagent Dispatch

**Feature Branch**: `015-subagent-async-dispatch`

**Created**: 2026-05-20

**Status**: Draft

**Input**: User description: "Implement async subagent dispatch — a fire-and-forget background agent execution model with task registry and notification system. Currently, subagent execution blocks the parent session's tool execution loop for the entire duration. The parent LLM cannot process other tool calls or produce output until the subagent completes. This feature enables subagents to run as independent background tasks, reporting results back to the parent via notifications when complete."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Launch Subagent in Background (Priority: P1)

As a parent agent orchestrating work, I want to dispatch a subagent to run in the background so that I can continue processing other tool calls and generating output without waiting for the subagent to finish.

**Why this priority**: This is the core value proposition. Without non-blocking dispatch, the entire feature has no purpose. Every other story depends on this capability existing.

**Independent Test**: Can be fully tested by invoking the agent tool with background mode enabled and verifying the parent receives an immediate acknowledgment while the subagent runs independently. Delivers the fundamental value of parallel agent execution.

**Acceptance Scenarios**:

1. **Given** a parent session is actively processing, **When** the LLM invokes the agent tool requesting background execution, **Then** the tool returns an immediate acknowledgment containing a task identifier without waiting for the subagent to complete.
2. **Given** a subagent has been launched in the background, **When** the parent's execution loop continues, **Then** the parent can process additional tool calls and produce output while the subagent runs concurrently.
3. **Given** a subagent has been launched in the background, **When** the subagent completes its work, **Then** the parent receives a notification containing the subagent's result at the next turn boundary.

---

### User Story 2 - Track Background Task State (Priority: P2)

As a parent agent managing multiple background subagents, I want to query the status and progress of running tasks so that I can make informed decisions about when to proceed or how to incorporate results.

**Why this priority**: Once background dispatch exists (P1), observability is the next critical need. Without visibility into task state, the parent agent operates blind — it cannot know whether tasks succeeded, failed, or are still running.

**Independent Test**: Can be fully tested by launching a background subagent, querying its status while running, and verifying the returned state accurately reflects the task's current lifecycle position (pending, running, completed, failed, killed).

**Acceptance Scenarios**:

1. **Given** one or more background subagents are running, **When** the parent requests a list of active tasks, **Then** the system returns all tasks with their current status, description, and progress indicators.
2. **Given** a background subagent has completed, **When** the parent queries the task by its identifier, **Then** the system returns the final result, status, and completion metadata.
3. **Given** a background subagent has failed, **When** the parent queries the task, **Then** the system returns the failure status and error information so the parent can decide how to recover.

---

### User Story 3 - Stop a Running Background Task (Priority: P3)

As a parent agent, I want to cancel a running background subagent that is no longer needed so that system resources are freed and stale work does not produce unwanted side effects.

**Why this priority**: Resource management and control. Once agents run independently (P1) and are observable (P2), the ability to cancel them is the natural next requirement. Without cancellation, runaway or obsolete subagents consume resources indefinitely.

**Independent Test**: Can be fully tested by launching a background subagent, sending a stop signal using the task identifier, and verifying the subagent ceases execution and its status transitions to killed. The parent should receive a notification confirming the cancellation.

**Acceptance Scenarios**:

1. **Given** a background subagent is currently running, **When** the parent issues a stop command for that task, **Then** the subagent ceases execution and its status transitions to killed.
2. **Given** a background subagent has been killed, **When** the parent receives the task notification, **Then** the notification includes any partial results the subagent produced before termination.
3. **Given** a stop command is issued for a task that has already completed, **When** the system processes the command, **Then** the system returns a clear indication that the task is already in a terminal state and no action was taken.

---

### User Story 4 - Coordinator Dispatches All Subagents Concurrently (Priority: P4)

As a coordinator agent orchestrating a complex multi-step workflow, I want all my subagents to automatically run as background tasks so that I can manage multiple agents working in parallel and synthesize their results as they arrive.

**Why this priority**: This is the multiplier use case that unlocks true multi-agent coordination. However, it depends on P1 (dispatch), P2 (tracking), and P3 (control) being solid. It is an extension of existing capabilities, not a new primitive.

**Independent Test**: Can be fully tested by activating coordinator mode, dispatching multiple subagents, and verifying they all run concurrently as background tasks. The coordinator should receive individual notifications as each subagent completes.

**Acceptance Scenarios**:

1. **Given** the system is operating in coordinator mode, **When** the coordinator dispatches a subagent, **Then** the subagent automatically runs as a background task regardless of whether the LLM explicitly requested background execution.
2. **Given** a coordinator has dispatched multiple concurrent subagents, **When** subagents complete in arbitrary order, **Then** the coordinator receives individual notifications for each completion and can process results as they arrive.
3. **Given** a coordinator has dispatched multiple subagents, **When** the coordinator queries active tasks, **Then** all dispatched subagents appear in the task list with their individual statuses.

---

### Edge Cases

- What happens when a background subagent attempts to launch its own background subagent (nested async dispatch)?
- How does the system handle a parent session being cancelled while background subagents are still running?
- What happens when the maximum number of concurrent background tasks is reached?
- How does the system behave when a notification arrives for a parent session that has already completed or been removed?
- What happens if the subagent's session creation fails after the task has been registered?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support launching subagents as independent background tasks that do not block the parent session's execution loop.
- **FR-002**: System MUST assign a unique task identifier to each background subagent at launch time and return it immediately to the parent.
- **FR-003**: System MUST maintain a per-instance registry of all active and recently completed background tasks with their current state.
- **FR-004**: System MUST deliver a notification to the parent session when a background subagent completes, fails, or is killed.
- **FR-005**: Notifications MUST be injected at turn boundaries (between LLM inference rounds), not mid-generation, to avoid disrupting the parent's current output.
- **FR-006**: System MUST provide a mechanism for the parent to query the status, progress, and result of any registered task.
- **FR-007**: System MUST provide a mechanism for the parent to cancel a running background task, triggering graceful termination.
- **FR-008**: Background subagents MUST have independent abort control — cancelling the parent session MUST NOT automatically cancel background subagents.
- **FR-009**: Task state transitions (completed, failed, killed) MUST be recorded before the corresponding notification is dispatched to avoid race conditions.
- **FR-010**: System MUST support coordinator mode where all subagent dispatches are forced to run as background tasks.
- **FR-011**: System MUST enforce a configurable limit on the number of concurrent background tasks per instance to prevent unbounded resource consumption.
- **FR-012**: System MUST propagate structured error information when a background subagent fails, including sufficient context for the parent to decide on recovery actions.

### Key Entities

- **Task**: A unit of background work with a unique identifier, lifecycle status, progress tracking, and an eventual result. Represents a single background subagent execution.
- **Task Registry**: A per-instance in-memory store that tracks all active and recently completed tasks, supports lookup by identifier, and provides listing capabilities.
- **Task Notification**: A structured message delivered to the parent session at turn boundaries, containing the task's final status, result, and resource usage summary.
- **Task Status**: The lifecycle state of a task — pending (registered but not yet running), running (actively executing), completed (finished successfully), failed (terminated due to error), or killed (explicitly cancelled).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A parent agent can dispatch a subagent and receive the task identifier within 100 milliseconds, regardless of how long the subagent takes to complete.
- **SC-002**: Background subagent results are delivered to the parent within one turn boundary of the subagent's completion.
- **SC-003**: A coordinator agent can manage at least 5 concurrent background subagents simultaneously without degradation in the parent's response latency.
- **SC-004**: Killing a background task results in the subagent ceasing execution and a notification being delivered within one turn boundary.
- **SC-005**: Task state queries return accurate, up-to-date information reflecting the real-time status of background subagents.
- **SC-006**: No background subagent execution blocks the parent session's ability to process other tool calls or generate output.

## Assumptions

- The existing session-per-subagent architecture provides sufficient isolation for background execution without additional sandboxing.
- Background subagent sessions are already persisted via the existing session creation mechanism, so no additional persistence layer is required for crash recovery in v1.
- The existing notification injection mechanism (CorrectionInjector) can be extended to handle task notifications without architectural changes.
- The LLM models used as parent agents can understand and act on structured task notifications delivered as synthetic messages.
- System resource limits (memory, compute) are managed at the infrastructure level; the task concurrency limit is a logical safeguard, not a resource management guarantee.
- Nested async dispatch (a background subagent launching its own background subagent) is out of scope for v1; background subagents run their own sub-calls synchronously.
- Auto-backgrounding (automatically converting long-running sync agents to background tasks) is deferred to a future iteration.
