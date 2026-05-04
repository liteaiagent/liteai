# Research: Subagent Result Flow

**Feature**: [010-subagent-result-flow]
**Context**: Decoupling the engine loop by routing child agent results directly through the call stack rather than via the database.

## Unknowns Addressed

None. The architectural analysis provided in `00-analysis.md` and `engine_loop_package_analysis.md` clearly defines the approach. 

## Decisions

### Decision 1: Use `SessionResult` for Child Inter-loop Communication
- **Decision**: The `SubagentOrchestrator` will await the direct `SessionResult` returned by `runSession` when executing a child agent. The result will be injected directly into the parent's `msgsBuffer`.
- **Rationale**: Currently, inter-loop communication is DB-mediated (child writes to DB, parent reads child's messages from DB). Relying on the return value conforms to the "forward-only loop" design principle and eliminates mid-loop DB reads.
- **Alternatives considered**: Continuing to use DB reads (rejected as it violates the decoupling principles and causes race conditions), using an event bus for child-to-parent communication (rejected as overly complex since `runSession` already returns a promise).

### Decision 2: Retain Subagent Persistence via Checkpointer
- **Decision**: The child agent will still use a `Checkpointer` to persist its message history.
- **Rationale**: While the parent doesn't need to read the DB, the UI still streams subagent progress via SSE, and the subagent conversation history must be preserved for audit/debugging. The checkpointer acts purely as an observer.
- **Alternatives considered**: Passing a `NoopCheckpointer` to child agents (rejected because subagent history would be lost, breaking UI streaming).

### Decision 3: Error Propagation
- **Decision**: Child agent errors will be returned as `{ status: "error", error: unknown }` in the `SessionResult`, which the parent handles directly.
- **Rationale**: Removes the "fire-and-forget" `Bus.publish` side effects. The parent agent receives the error synchronously and can decide how to handle it (e.g., wrap in a tool execution error, surface to user, etc.).
