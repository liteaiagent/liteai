# Research: Sub-Agent Architecture

**Feature**: 002-subagent-architecture  
**Date**: 2026-04-11

## R-001: Context Forking Isolation Model

**Decision**: Selective clone model — clone immutable/read-heavy parent state (file cache, content replacement state), link lifecycle-critical state (abort controller with child hierarchy), wrap mutable state (app state with permission avoidance), and create fresh isolates for per-agent state (tool decisions, messages, query tracking).

**Rationale**: The liteai2 reference implementation (`forkedAgent.ts:L345–462`) demonstrates that this selective model achieves both isolation safety and performance. Full deep-clone would be prohibitively expensive for file caches (hundreds of MB in large projects). Full sharing would break isolation guarantees. The selective model allows sub-agents to benefit from the parent's warm file cache while preventing side effects from leaking back.

**Alternatives considered**:
- **Full deep clone**: Rejected — `readFileState` can be 100MB+ in large projects. Cloning is O(n) per spawn, unacceptable for <100ms target.
- **Full sharing with copy-on-write**: Rejected — JavaScript does not natively support COW semantics. Would require a Proxy-based implementation adding complexity and runtime overhead.
- **Snapshot isolation (immutable parent + overlay in child)**: Considered but unnecessary given that tool decisions and messages are the primary mutation targets, and they are already isolatable by creating fresh instances.

## R-002: AsyncLocalStorage for Agent Identity Isolation

**Decision**: Use Node.js `AsyncLocalStorage<AgentContext>` to maintain per-agent identity context across async continuations. Wrap entire agent execution via `runWithAgentContext()`.

**Rationale**: Multiple background agents share the same Node.js process. Without ALS, analytics events from Agent A would incorrectly use Agent B's context when reading shared `AppState`. ALS provides zero-overhead context propagation that naturally follows Promise chains, `await` boundaries, and callback invocations. The liteai2 implementation (`agentContext.ts:L93`) validates this approach at scale.

**Alternatives considered**:
- **Thread-local storage**: Not applicable — Node.js is single-threaded (Bun uses the same event loop model).
- **Explicit context passing**: Rejected — would require threading an `agentContext` parameter through 50+ function signatures across the entire call stack. Fragile and invasive.
- **WeakMap keyed by agent ID**: Rejected — doesn't solve the assignment problem (which agent is "current" at any given point in the async graph).

## R-003: Sidechain Transcript Storage Format

**Decision**: Append-only JSONL (one JSON object per line) stored at `<sessionDir>/<sessionId>/subagents/<subdir>/agent-<agentId>.jsonl`. Each message is appended as a single line, using `fs.appendFile()` for atomic appends.

**Rationale**: JSONL avoids the re-serialization problem inherent in updating a JSON array. Appending a single line is O(1) regardless of transcript length. File-per-agent isolation prevents concurrent write conflicts. The path convention mirrors liteai2's `sessionStorage.ts:L247`.

**Alternatives considered**:
- **SQLite transcript table**: Rejected — adds DB schema complexity and couples transcripts to the session DB. Filesystem storage is simpler, more portable, and naturally supports streaming reads for debugging tools.
- **Single JSON file per agent**: Rejected — requires reading, parsing, appending, and rewriting the entire file for each message. O(n) cost per write.
- **In-memory only**: Rejected — must survive process crashes for post-mortem debugging.

## R-004: Permission Sandboxing Strategy

**Decision**: Mode inheritance with precedence rules + silent deny for background agents.

1. **Mode inheritance**: Parent's elevated modes (`bypass`, `auto`, `accept-edits`) always override the sub-agent's declared mode. Sub-agent modes only escalate if less permissive than parent.
2. **Background silent deny**: When `shouldAvoidPermissionPrompts` is true, any tool requiring interactive permission gets an immediate denial response.
3. **Tool allow-list replacement**: When a sub-agent specifies `allowedTools`, session-level tool decisions are replaced entirely (not merged). CLI-level rules from SDK `--allowedTools` are preserved.

**Rationale**: Silent-deny prevents indefinite blocking of background agents. Mode inheritance prevents permission escalation attacks where a sub-agent could declare `bypass` mode. Replace-not-merge for tool lists follows the principle of least privilege — the sub-agent should only have access to explicitly declared tools, not inherit the parent's broad approvals.

**Alternatives considered**:
- **Queuing permissions for later approval**: Rejected — introduces unbounded wait times and complex state management. Silent-deny with structured error is simpler and provides clear feedback.
- **Merging parent and child tool permissions**: Rejected — violates least privilege. A sub-agent scoped to `["read_file", "search"]` should not gain `write_file` access just because the parent approved it.

## R-005: Docker Remote Isolation

**Decision**: Use Docker CLI (`docker run -d`) for remote isolation. Container images are pre-built or configurable. Agent execution is wrapped in a container with the project directory mounted read-only and a scratch workspace mounted read-write. Containers are retained for TTL-based cleanup rather than auto-removed.

**Rationale**: Docker CLI is universally available, requires no additional SDK dependencies, and provides full process/filesystem isolation. Containers are retained (no `--rm`) for a configurable TTL to enable post-mortem debugging, then garbage collected lazily on next session start. The architecture avoids tight coupling to any specific container runtime API.

**Alternatives considered**:
- **Docker SDK (dockerode)**: Rejected — heavyweight dependency, complex lifecycle management. CLI is simpler and sufficient.
- **Podman**: Considered but Docker is more universally available. Podman can be aliased as `docker`.
- **Firecracker/microVMs**: Rejected — massive complexity overhead for the isolation needed. Docker containers are sufficient.

## R-006: Deterministic Cleanup Sequence

**Decision**: 12-step cleanup in a `finally` block, each step wrapped in try-catch to ensure subsequent steps execute even if one fails. Steps ordered by dependency (MCP connections first, then hooks, cache, file state, etc.).

**Rationale**: Idempotent, non-throwing cleanup prevents resource leaks in long-running sessions. The ordering ensures that resources with external lifecycle (MCP connections, shell processes) are cleaned up before internal bookkeeping (tracing, todos). Each step's try-catch prevents cascade failures where one cleanup error would skip all subsequent steps.

**Alternatives considered**:
- **Disposable pattern (`Symbol.dispose`)**: Considered — would be cleaner but Bun's support for explicit resource management is still experimental. Deferred to a future refactor.
- **Event-driven cleanup via Bus**: Rejected — ordering guarantees are harder to enforce with event-driven patterns. A sequential `finally` block provides deterministic execution order.

## R-007: Concurrent Agent Limit Enforcement

**Decision**: Configurable limit (default: 8) enforced at spawn time via an atomic counter per session. Exceeding the limit throws a `ConcurrentAgentLimitError` structured error.

**Rationale**: Fail-fast rejection is simpler and more predictable than queuing (which introduces unbounded memory growth and starvation risks). The counter is tracked per-session (not process-wide) to maintain tenant isolation.

**Alternatives considered**:
- **Spawn queue with backpressure**: Rejected — adds complexity (priority ordering, starvation prevention, timeout handling) without clear benefit. The LLM calling pattern naturally serializes work within each agent.
- **Process-wide limit**: Rejected — violates multi-tenant isolation. Session A spawning 10 agents should not prevent Session B from spawning agents.

## R-008: Wall-Clock Timeout Implementation

**Decision**: Per-agent `setTimeout` that invokes `abortController.abort()` when the wall-clock limit is exceeded. Default: 30 minutes. No grace period — hard-kill with immediate abort signal.

**Rationale**: The abort controller hierarchy (FR-005) ensures the timeout abort propagates to all child operations (LLM streams, tool executions, MCP calls). Partial result extraction (FR-023) preserves the last meaningful output. A grace period would add complexity without benefit — tools should already handle `AbortSignal` cooperatively.

**Alternatives considered**:
- **Soft timeout with warning + grace period**: Rejected per spec clarification (2026-04-11) — hard-kill, no grace period.
- **Turn-count-only limiting**: Rejected — wall-clock timeout catches scenarios where a single tool execution runs indefinitely (e.g., stuck MCP call).

## R-009: Agent Memory Architecture

**Decision**: Filesystem-backed MEMORY.md per agent type with 3 scope levels (`user`, `project`, `local`). Contents injected into system prompt at spawn. Read/Write/Edit tools auto-injected when enabled.

**Rationale**: Agent memory is orthogonal to context forking — it's keyed by agent type, not session lineage. This means the "explore" agent always reads explore's memory regardless of which parent spawned it. The filesystem approach (MEMORY.md + supporting files) is simple, portable, and version-controllable (for `project` scope).

**Alternatives considered**:
- **Database-backed memory**: Rejected — MEMORY.md is human-readable, versionable, and doesn't require schema migrations.
- **Session-inherited memory**: Rejected per spec design — memory is per-agent-type, orthogonal to context forking.

## R-010: Critical System Reminder Injection

**Decision**: Static string configured per-agent, injected as a `<system-reminder>` wrapped user message on every turn via the attachment system. Positioned after all other attachments for maximum recency.

**Rationale**: Models lose adherence to behavioral constraints over long conversations. Re-injecting a short reminder on every turn (e.g., "CRITICAL: You are in read-only mode. Do not modify files.") maintains behavioral compliance. The attachment system already supports per-turn injection, making this a lightweight extension.

**Alternatives considered**:
- **System prompt only**: Rejected — system prompt is at the beginning of the context window. Models give less weight to distant instructions.
- **Dynamic generation from mode state**: Already exists for plan mode reminders. The `criticalSystemReminder` field is the static, agent-scoped complement configured at definition time.
