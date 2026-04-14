# Feature Specification: Fork Subagent + Agent Durability

**Feature Branch**: `003-fork-subagent-durability`  
**Created**: 2026-04-14  
**Status**: Draft  
**Input**: User description: "Implement cache-identical fork subagent spawning model and agent resume from sidechain transcripts for background agent durability"

## Clarifications

### Session 2026-04-14

- Q: What valid states can a fork child (or any background agent) be in for resume purposes? → A: Qualified state model — running → completed / interrupted / killed → resumable (after transcript validation). Resume only from "resumable" state.
- Q: Should elevated parent permission modes (bypassPermissions, acceptEdits, auto) override the fork child's bubble permission mode? → A: Yes — match MVP behavior. Elevated parent modes override bubble. Document as a composition rule in FR-001.
- Q: Should there be a maximum number of concurrent fork children per parent? → A: No hard limit — match MVP. Concurrency is naturally bounded by the parent's turn budget and provider-side rate limits.
- Q: If a fork child experiences an unexpected prompt cache miss from the upstream provider (e.g., due to eviction or prefix mismatch), how should the system handle it? → A: (MVP Parity) Proceed normally and rely on telemetry to track the cache hit rate and token costs.
- Q: When concurrent fork children collectively hit the upstream provider's rate limits, how should the system handle rejected requests? → A: Fail-Fast + Notification (MVP parity). Each fork child's query loop handles API errors independently via transport-layer retry. If retries are exhausted, the child fails with a structured error notification to the parent. No spawning-layer queuing or serialization.
- Q: What transcript size constraint applies to the 5-second resume SLA (SC-002)? → A: No hard transcript size limit. The 5-second SLA applies to typical operational transcripts (≤2000 messages). If extremely large transcripts cause degradation, surface a diagnostic warning via telemetry rather than rejecting the resume.
- Q: If a fork child fails to spawn entirely (non-retryable API error, context construction failure), how should the error be surfaced? → A: Structured failure notification to parent via FR-022's notification path. The parent continues unblocked.
- Q: Should fork children have a maximum wall-clock duration in addition to the 200-turn limit? → A: Yes — 30-minute configurable wall-clock timeout. After expiration, the child is killed with partial results preserved (FR-021).

## Reference Implementation Mandate

All work on this feature — specification, planning, task decomposition, design decisions, code implementation, and code reuse — MUST be grounded on the MVP reference implementation at `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\src`. The target is **same or superior** quality and behavioral parity; no degradation from MVP is acceptable. Key reference files include `tools/AgentTool/forkSubagent.ts`, `tools/AgentTool/resumeAgent.ts`, `utils/forkedAgent.ts`, `tools/AgentTool/agentToolUtils.ts`, and `tools/SendMessageTool/SendMessageTool.ts`.

The MVP was built as a **CLI application**; this project implements a **multi-tenant HTTP/SSE backend server**. All patterns from the MVP must be adapted to the backend architecture (e.g., session-scoped state instead of process-global state, tenant isolation, concurrent connection management) while preserving behavioral equivalence or improving upon it.

> **Propagation directive**: This mandate MUST be carried forward into `plan.md` and `tasks.md` when those artifacts are generated, ensuring every implementation task references the relevant MVP source for design grounding and parity validation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cache-Optimized Sub-Agent Spawning via Fork (Priority: P1)

When a parent agent determines a task should be delegated to a sub-agent and fork spawning is active, the system spawns a fork child that inherits the parent's full conversation context and rendered system prompt. The child's request to the upstream provider shares the parent's prompt cache, eliminating redundant prompt processing for every sub-agent spawn. This dramatically reduces cost and latency in multi-agent workflows.

**Why this priority**: Fork spawning is the primary cost/performance optimization for multi-agent workflows. Every sub-agent spawn benefits from cache sharing. Without it, each child re-submits the full system prompt and context independently, wasting tokens and adding latency. In high-concurrency scenarios (multiple background agents), the savings compound multiplicatively.

**Independent Test**: Can be fully tested by spawning a fork child from a parent with a known conversation context and verifying that the child's upstream request shares the parent's prompt cache. Delivers measurable prompt cache hit rates and reduced token consumption.

**Acceptance Scenarios**:

1. **Given** a parent agent with an active conversation and fork spawning enabled, **When** the parent delegates a task via the agent tool, **Then** the system constructs a fork child whose upstream request prefix is cache-compatible with the parent's.
2. **Given** fork spawning is enabled, **When** ANY agent is spawned (not just fork-specific requests), **Then** the spawn is forced into async mode and the parent receives a task notification interaction rather than inline results.
3. **Given** a fork child is executing, **When** the fork child attempts to spawn its own sub-agent via fork, **Then** the system detects the recursion and blocks the fork, falling back to standard sub-agent spawning.
4. **Given** multiple fork children spawned simultaneously from the same parent, **When** each child receives its context, **Then** all children share the same cache-compatible prefix with only the per-child directive differing.

---

### User Story 2 - Agent Resume from Persisted Transcripts (Priority: P2)

When a background agent is interrupted — due to a process restart, crash, explicit kill, or session timeout — the system can resume that agent from its persisted sidechain transcript and metadata. The resumed agent picks up where it left off with full prior context, cleaned-up message history, and cache stability, without re-executing already-completed work.

**Why this priority**: Durability is critical for long-running background tasks such as multi-file refactors, complex test generation, or large-scale code migrations. Without resume capability, any interruption forces a full restart from scratch, losing all progress and wasting significant compute. This directly impacts user trust in delegating long tasks to background agents.

**Independent Test**: Can be fully tested by running a background agent, persisting its sidechain transcript, simulating an interruption, then invoking resume and verifying the agent continues from its last valid state with no re-execution of prior work.

**Acceptance Scenarios**:

1. **Given** a background agent that was interrupted after completing 5 of 10 subtasks with a persisted sidechain transcript, **When** the system resumes the agent, **Then** the agent starts from subtask 6 with full context of subtasks 1–5 and no repeated work.
2. **Given** a persisted transcript containing orphaned messages (thinking-only, whitespace-only assistant messages, and incomplete tool exchanges), **When** the agent is resumed, **Then** those orphaned messages are filtered out before the agent receives its reconstructed history.
3. **Given** a fork child that was interrupted, **When** the system resumes it, **Then** the parent's system prompt is re-threaded into the child's context for continued cache sharing.
4. **Given** an agent that was interrupted with content optimization state (e.g., large tool results persisted to disk), **When** the agent is resumed, **Then** the optimization state is reconstructed from transcript records and applied identically to preserve cache stability.
5. **Given** a resumed agent, **When** the system distinguishes it from a freshly-spawned agent, **Then** the agent's invocation is marked as a resume for telemetry and observability purposes.

---

### User Story 3 - Fork Child Behavioral Contract (Priority: P2)

When a fork child is spawned, it receives a strict behavioral contract that constrains its execution to be focused, efficient, and non-conversational. The child executes its directive silently using tools, commits changes, and delivers a structured report. This ensures predictable, machine-parseable output from background workers.

**Why this priority**: Without a behavioral contract, fork children would behave like interactive agents — asking questions, providing commentary, and producing unpredictable output. The constraint ensures background workers are efficient, stay within scope, and produce consistent structured reports that the parent can reliably consume.

**Independent Test**: Can be fully tested by spawning a fork child with a specific directive and verifying that it follows all behavioral rules: uses tools directly, does not spawn sub-agents, commits changes, produces a structured report under 500 words, and stays within scope.

**Acceptance Scenarios**:

1. **Given** a fork child is spawned with a directive, **When** the child executes, **Then** the child does NOT spawn sub-agents (despite having the agent tool available for cache compatibility), does NOT ask questions, and does NOT editorialize.
2. **Given** a fork child completes its work, **When** it produces output, **Then** the output follows a structured format: Scope, Result, Key files, Files changed (with commit hash), and Issues.
3. **Given** a fork child modifies files, **When** it prepares its report, **Then** it commits changes before reporting and includes the commit hash.
4. **Given** a fork child discovers work outside its directive scope, **When** it prepares its report, **Then** it mentions out-of-scope findings in at most one sentence.

---

### User Story 4 - Fork-Aware Worktree Isolation (Priority: P3)

When a fork child is spawned and assigned to an isolated worktree (a cloned filesystem workspace), the system injects path translation guidance into the child's context. This ensures the child correctly interprets file paths from the parent's conversation (which reference the parent's workspace) and maps them to the corresponding paths in its own worktree clone.

**Why this priority**: Without path translation, fork children operating in worktrees would attempt to modify files at the parent's paths, breaking isolation guarantees established in Phase 2. This is an integration concern that ensures fork and worktree isolation compose correctly.

**Independent Test**: Can be fully tested by spawning a fork child in a worktree, verifying the path translation notice is present in the child's context, and confirming the child resolves file references to worktree-local paths.

**Acceptance Scenarios**:

1. **Given** a fork child spawned with worktree isolation active, **When** the child's context is constructed, **Then** the context includes a notice mapping the parent's workspace path to the child's worktree path, with guidance to re-read files before editing.
2. **Given** a fork child in a worktree, **When** the child references a file path from the parent's conversation, **Then** the child operates on the worktree-local equivalent of that path, not the parent's original path.
3. **Given** a fork child in a worktree, **When** the child's notice is generated, **Then** it explicitly states that changes stay in the worktree and will not affect the parent's files.

---

### User Story 5 - Teammate Re-engagement via Messaging (Priority: P3)

When a user wants to revisit or continue work with a previously completed or interrupted background agent, they can re-engage with that agent through the messaging tool. The system provides 3-way routing: running agents receive the message at their next opportunity, stopped agents are auto-resumed, and agents whose state has been evicted are resumed from their persisted transcript.

**Why this priority**: This is a UX enhancement that extends the resume capability to user-initiated re-engagement. It allows users to ask follow-up questions, request modifications, or continue delegated work sessions even after the original agent has finished or been interrupted.

**Independent Test**: Can be fully tested by completing a background agent run, then sending a follow-up message to that agent and verifying the agent responds with full awareness of its prior work.

**Acceptance Scenarios**:

1. **Given** a running background agent, **When** the user sends a message to that agent by name or ID, **Then** the message is queued for delivery at the agent's next tool round.
2. **Given** a stopped background agent with its task still tracked in the session, **When** the user sends a message via the messaging tool, **Then** the agent is auto-resumed in the background with the message as its new prompt.
3. **Given** a background agent whose task has been evicted from session state, **When** the user sends a message via the messaging tool, **Then** the agent is resumed from its disk transcript in the background with the message as its new prompt.
4. **Given** a completed background agent with a persisted sidechain transcript, **When** the user sends a follow-up message, **Then** the agent responds with full awareness of its previous work.
5. **Given** a killed background agent with partial results, **When** the user re-engages, **Then** the agent resumes from the cleaned-up transcript with all partial results intact and visible.

---

### User Story 6 - Async Agent Lifecycle Observability (Priority: P4)

When a background agent (fork or standard) is executing, the system provides real-time progress updates, optional agent summarization, and structured notifications on completion, failure, or kill. This ensures users have visibility into long-running background work and receive actionable results.

**Why this priority**: Without lifecycle observability, background agents are opaque to users. Progress tracking, summarization, and structured notifications ensure users can monitor, manage, and act on background agent work.

**Independent Test**: Can be fully tested by spawning a background agent, verifying progress updates appear in real-time, and confirming that completion/kill notifications include the expected data (result text, usage metrics, worktree info).

**Acceptance Scenarios**:

1. **Given** a background agent executing tool calls, **When** the agent completes each tool use, **Then** the system provides a real-time progress update with tool use count and activity description.
2. **Given** a long-running background agent, **When** summarization is enabled, **Then** the system periodically summarizes the agent's work for user visibility.
3. **Given** a background agent that completes successfully, **When** the completion notification is generated, **Then** it includes the agent's final message, usage metrics (tokens, tool uses, duration), and worktree information if applicable.
4. **Given** a background agent that is killed, **When** the kill notification is generated, **Then** it includes partial results extracted from the agent's last coherent assistant message.
5. **Given** a background agent that fails with an error, **When** the failure notification is generated, **Then** it includes the structured error message.

---

### User Story 7 - Post-Turn Fork Cache Sharing (Priority: P4)

When the main agent loop completes a turn, background system tasks (summarization, memory extraction, prompt suggestion) that fork from the main loop can share the main loop's prompt cache. This avoids redundant cache creation for system-internal work that runs after each user interaction.

**Why this priority**: Without post-turn cache sharing, each system-internal fork would create its own cache entry, wasting cache slots and increasing cost. Sharing the main loop's cache parameters makes system-internal forks essentially free in terms of cache overhead.

**Independent Test**: Can be fully tested by completing a main loop turn, then running a post-turn fork and verifying it achieves a prompt cache hit from the main loop's cached context.

**Acceptance Scenarios**:

1. **Given** the main agent loop completes a turn, **When** the system preserves the cache-critical parameters, **Then** subsequent post-turn forks can access those parameters and share the main loop's prompt cache.
2. **Given** a post-turn fork (e.g., agent summarization), **When** the fork runs, **Then** it achieves a prompt cache hit with the main loop's context, not a cache miss.

---

### Edge Cases

- **Unexpected prompt cache miss**: If a fork child experiences a cache miss from the upstream provider (e.g., due to cache eviction or prefix divergence), the system must proceed normally to prioritize task completion. The cache inefficiency is tracked silently via telemetry, matching MVP behavior.
- **Fork recursion attempt**: A fork child attempts to spawn its own sub-agent via fork. The system must detect that the child is itself a fork and block recursive forking, falling back to standard sub-agent spawning.
- **Feature gate conflicts**: Fork spawning is requested but the session is in coordinator mode or is non-interactive. The system must silently disable fork and fall back to standard spawning without errors.
- **Resume with GC'd worktree**: An agent is resumed but its worktree was garbage-collected during the interruption. The system must detect the missing worktree, fall back to the parent's working directory with a diagnostic log, and NOT crash.
- **Resume with orphaned messages**: The transcript contains incomplete exchanges — thinking-only assistant messages, whitespace-only content, or tool calls without matching responses. These must be filtered before resume to prevent model confusion.
- **Resume after partial kill**: An agent was killed mid-execution and has partial work artifacts. The system must extract and preserve partial results so the resumed agent can continue from the last coherent state.
- **Fork + worktree path mismatch**: File paths referenced in the parent's conversation do not exist in the worktree (e.g., files created after the worktree was cloned). The path translation notice must account for this divergence.
- **Concurrent fork children**: Multiple fork children spawned simultaneously from the same parent must each receive independent copies of the forked context without cross-contamination. There is no system-level concurrency limit; concurrency is naturally bounded by the parent's turn budget and provider-side rate limits.
- **Content optimization state divergence on resume**: The optimization state reconstructed from transcript records must exactly match the state that existed at interruption to maintain cache stability. Mismatches must be detected and reported.
- **Resume with changed feature gate state**: An agent originally spawned when a feature gate was enabled is resumed after the gate was disabled. The system must handle gracefully without crashing.
- **Concurrent resume attempts**: Multiple resume requests for the same agent arrive simultaneously. The system must handle this without duplicate execution or state corruption.
- **Fork child with no tool calls**: The parent's assistant message contains no tool calls (edge case). The fork child must still receive a valid context with the directive, falling back to directive-only messages.
- **Ephemeral fork transcript skipping**: System-internal forks (summarization, speculation) that don't need persistence must be able to skip transcript recording for performance.
- **Worktree mtime refresh timing**: A resumed agent's worktree must have its activity timestamp refreshed BEFORE the agent begins execution, to prevent a race with the garbage collection process.
- **Fork child tool pool identity**: Fork children must receive the parent's exact tool pool (not a re-filtered subset) to maintain cache compatibility. The agent tool remains in the pool but fork spawning is blocked at call time, not at tool availability time.
- **Provider rate limit exhaustion during concurrent forks**: When multiple concurrent fork children hit the provider's rate limits, each child handles retries independently at the transport layer (per-request exponential backoff with Retry-After headers). If retries are exhausted, the child fails immediately with a structured error notification to the parent — no spawning-layer queuing, serialization, or coordination between siblings. This matches MVP behavior where rate-limit resilience is a transport concern, not an orchestration concern.
- **Resume with very large transcripts**: If a transcript exceeds typical size (≤2000 messages), the system must still attempt resume without rejecting it. Degraded performance beyond the 5-second SLA is surfaced as a diagnostic warning via telemetry, not treated as a failure.
- **Fork child spawn failure**: If a fork child fails to spawn entirely (non-retryable API error such as 400 context-length overflow, or context construction exception), the system must treat it as an async agent failure and surface a structured failure notification to the parent via FR-022's notification path. The parent's execution continues unblocked.
- **Fork child wall-clock timeout**: If a fork child reaches its wall-clock timeout (default 30 minutes), the system must kill the child, preserve partial results (per FR-021), and surface a kill notification to the parent. The timeout is configurable to accommodate legitimate long-running tasks.

## Requirements *(mandatory)*

### Functional Requirements

#### Fork Subagent Model

- **FR-001**: System MUST define a fork agent configuration that grants the child full parent tool access, inherits the parent's model, uses bubble permission mode (surfacing permission prompts to the parent terminal), allows up to 200 turns, and enforces a configurable wall-clock timeout (default 30 minutes). However, elevated parent permission modes (bypassPermissions, acceptEdits, auto) MUST override the fork child's bubble mode — if the parent session has already opted into a permissive mode, the fork child inherits that mode rather than forcing interactive prompts for background workers.
- **FR-002**: System MUST construct fork child context such that the upstream provider can serve the shared portion between parent and child entirely from its prompt cache, maximizing cache hit rates.
- **FR-003**: System MUST prevent fork children from recursively forking by detecting that a child is itself a fork at spawn time and blocking the attempt, falling back to standard sub-agent spawning.
- **FR-004**: System MUST gate fork availability such that fork spawning is disabled in coordinator mode and non-interactive sessions, with no user-visible error — standard spawning is used as the fallback.
- **FR-005**: System MUST force ALL agent spawns into async mode when fork spawning is enabled, ensuring a unified task-notification interaction model regardless of agent type.
- **FR-006**: System MUST inject a worktree path translation notice into the fork child's context when the child operates in an isolated worktree, mapping parent workspace paths to worktree-local paths and instructing the child to re-read files before editing.
- **FR-007**: System MUST pass the parent's already-rendered system prompt to the fork child without recomputation, preserving exact identity for prompt cache hits. Recomputation is forbidden because the result may diverge due to dynamic state (feature flag warm/cold, time-dependent content).
- **FR-008**: System MUST deliver the fork child a behavioral contract that constrains it to: (a) execute directly without spawning sub-agents, (b) use tools silently then report once at the end, (c) stay strictly within the directive's scope, (d) commit changes before reporting with commit hash, (e) produce a structured report (Scope, Result, Key files, Files changed, Issues) under 500 words.
- **FR-009**: System MUST give fork children the parent's exact tool pool (including the agent tool itself) to maintain cache-compatible tool definitions. Fork recursion is blocked at call time, not by removing the tool from the pool.

#### Agent Resume from Sidechain Transcripts

- **FR-010**: System MUST reconstruct an agent's execution state from its persisted sidechain transcript and agent metadata, restoring all messages, tool results, and context needed to continue execution.
- **FR-011**: System MUST reconstruct content optimization state from transcript records to maintain cache stability when the resumed agent's next request is sent to the provider. For fork-child resume, the parent's live optimization state is used to gap-fill entries that were inherited but never persisted as new records.
- **FR-012**: System MUST restore the agent's worktree path on resume, verify the worktree still exists on disk, and refresh its last-activity timestamp to prevent garbage collection. If the worktree no longer exists, the system MUST fall back to the parent's working directory with a diagnostic log rather than crashing.
- **FR-013**: System MUST re-thread the parent's system prompt into a fork child's context on resume. If the rendered system prompt is available from the parent context, it MUST be used directly. If unavailable, the system MUST rebuild it from the session's current configuration. If reconstruction fails, the system MUST throw an explicit error rather than proceeding with a mismatched prompt.
- **FR-014**: System MUST filter orphaned messages from the reconstructed transcript before resuming — specifically: thinking-only assistant messages (no text content), whitespace-only assistant messages, and tool calls without a matching tool response.
- **FR-015**: System MUST support teammate re-engagement through the messaging tool with 3-way routing: (a) running agent → queue message for delivery at next tool round, (b) stopped agent with task still tracked in session → auto-resume with the message as prompt, (c) agent with task evicted from session state → resume from disk transcript.
- **FR-016**: System MUST maintain an agent name registry mapping human-readable agent names to agent IDs, enabling re-engagement by name through the messaging tool. The registry persists across the session lifecycle.
- **FR-017**: System MUST mark resumed agents with a distinct invocation kind ('resume') in their agent context to distinguish them from freshly-spawned agents for telemetry and observability.
- **FR-018**: System MUST skip re-gating permission checks on resume — the original spawn already passed permission checks, and re-gating could block a previously-approved agent.

#### Async Agent Lifecycle Management

- **FR-019**: System MUST provide real-time progress tracking for all async agents, reporting tool use counts and activity descriptions as each tool round completes.
- **FR-020**: System MUST support optional agent summarization for long-running async agents, providing periodic summaries of the agent's work. Summarization MUST be enabled when fork spawning is active, coordinator mode is active, or explicitly requested.
- **FR-021**: System MUST preserve partial results when an async agent is killed, extracting text content from the last coherent assistant message and including it in the kill notification.
- **FR-022**: System MUST generate structured completion/failure/kill notifications for all async agents, including the agent's final message, usage metrics (tokens consumed, tool uses, duration), and worktree information if applicable.
- **FR-023**: System MUST preserve cache-critical parameters from the main agent loop's latest turn, enabling post-turn system forks (summarization, memory extraction) to share the main loop's prompt cache without each caller threading parameters manually.

#### Subagent Context Isolation

- **FR-024**: System MUST create fully isolated execution contexts for fork children, including: (a) cloned file state cache, (b) independent abort controller linked to the parent (parent abort propagates to child), (c) isolated denial tracking state, (d) no-op mutation callbacks for UI state, (e) fresh query tracking chain with incremented depth.
- **FR-025**: System MUST clone the parent's content optimization state for cache-sharing forks so that the fork makes identical optimization decisions as the parent — identical decisions produce identical wire prefixes, preserving cache hits. For non-forking subagents, the clone is harmless since parent IDs never match.
- **FR-026**: System MUST support ephemeral fork variants that skip transcript recording for system-internal work (summarization, speculation), reducing I/O overhead for fire-and-forget operations.

#### Constraints

- **C-001**: All implementation MUST achieve behavioral parity with or superiority to the MVP reference implementation (`liteai_cli_mvp/src`), adapted from CLI to multi-tenant HTTP/SSE backend architecture. No behavioral degradation from MVP is acceptable. See *Reference Implementation Mandate* section above for full context and key reference files.

### Key Entities

- **Fork Agent Definition**: The configuration describing fork child behavior — permission mode (bubble), model inheritance (inherit from parent), tool access (all parent tools), maximum turn count (200). This is a distinct agent definition type, not a variation of standard sub-agent configuration. Its system prompt is unused; the parent's rendered prompt is threaded directly.
- **Forked Message Set**: The constructed context given to a fork child, designed so the shared portion between parent and child is cache-compatible. Only the per-child directive differs between siblings, maximizing cache hits across concurrent fork children.
- **Fork Behavioral Contract**: The set of rules injected into fork children constraining their behavior to be non-conversational, tool-driven, scope-bound, and report-structured. This contract is a critical UX property ensuring predictable, machine-parseable output from background workers.
- **Sidechain Transcript Record**: The persisted record of a previous agent run's conversation history, stored on disk as part of Phase 2's transcript infrastructure. Contains all messages, tool interactions, and metadata needed for state reconstruction.
- **Agent Metadata**: Observability and lifecycle data persisted alongside the transcript — agent name, agent type, start time, completion status, parent agent reference, model used, worktree path, task description. Used during resume to reconstruct the execution context.
- **Content Optimization State**: A mapping tracking which tool results have been persisted to disk and replaced with previews. On resume, this state is reconstructed from transcript records so that the same optimization decisions are replayed identically — divergent decisions would produce different wire prefixes and break prompt cache.
- **Worktree Reference**: The isolated filesystem clone associated with an agent run. On resume, the system verifies the worktree still exists and refreshes its activity timestamp to prevent premature garbage collection.
- **Cache-Critical Parameters**: The set of parameters whose identity between parent and child determines whether the upstream provider can share prompt cache. Includes: system prompt, user context, system context, tool configuration, and fork context messages. A global slot is maintained for post-turn forks to share the main loop's cache.
- **Agent Name Registry**: A session-scoped mapping of human-readable agent names to agent IDs. Enables re-engagement by name through the messaging tool and persists across the session lifecycle.
- **Agent Lifecycle State**: Background agents follow a qualified state model: `running → completed | interrupted | killed → resumable` (after transcript validation). Resume is only permitted from the `resumable` state, which requires a valid persisted transcript that passes orphaned-message filtering.
- **Fork Recursion Guard**: A detection mechanism that identifies whether a child agent is itself a fork, preventing infinite fork chains. The guard operates at spawn time — fork children retain the agent tool in their pool (for cache compatibility) but are blocked from using it for fork spawning.
- **Worktree Path Translation Notice**: A contextual notice injected into fork children operating in worktrees, mapping the parent's workspace paths to the child's worktree paths and instructing the child about isolation semantics.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sub-agent spawning with fork achieves shared prompt cache with the parent, reducing per-spawn prompt processing tokens by at least 80% compared to independent spawning with the same context.
- **SC-002**: A previously-interrupted background agent resumes within 5 seconds of resume invocation and retains full prior context without re-executing any completed work. This SLA applies to typical operational transcripts (≤2000 messages); larger transcripts may degrade gracefully with a diagnostic telemetry warning.
- **SC-003**: 100% of fork child recursion attempts are detected and blocked, with zero undetected recursive fork spawns in any test scenario.
- **SC-004**: Resumed agents produce results indistinguishable from agents that ran uninterrupted, for the same scope of work completed before interruption.
- **SC-005**: Fork spawning is automatically and silently disabled in incompatible modes (coordinator, non-interactive) with zero user-visible errors or degraded functionality — standard spawning is used seamlessly.
- **SC-006**: Message cleanup on resume removes 100% of orphaned, thinking-only, and whitespace-only messages from the reconstructed transcript, resulting in a clean context that produces no model confusion or errors.
- **SC-007**: Fork child worktree path translation correctly maps all parent-referenced file paths to worktree-local equivalents, producing zero file-not-found errors caused by path mismatch.
- **SC-008**: 100% of async agents provide real-time progress updates during execution, with updates visible within 2 seconds of each tool round completing.
- **SC-009**: 100% of killed agents preserve and surface partial results in their kill notification, enabling users to see what was accomplished before the kill.
- **SC-010**: Fork children produce structured reports following the behavioral contract in 100% of successful completions, with each report containing at minimum the Scope and Result sections.
- **SC-011**: Teammate re-engagement via messaging correctly routes messages in all three scenarios (running → queue, stopped → auto-resume, evicted → resume from disk) with zero misrouted messages.
- **SC-012**: Content optimization state reconstructed on resume produces byte-identical decisions to the original run, resulting in zero cache misses caused by state divergence.
- **SC-013**: Post-turn system forks achieve prompt cache hits with the main loop's cached context in at least 90% of cases, reducing system-internal fork cost by at least 70%.

## Assumptions

- Phase 2 sub-agent infrastructure (context forking, sidechain transcripts, worktree isolation, async lifecycle management, agent metadata persistence) is fully implemented and stable before Phase 4 begins.
- The upstream AI provider supports prefix-based prompt caching where cache-compatible request prefixes share cache entries across requests.
- Sidechain transcripts are persisted to disk in a structured, recoverable format as defined in Phase 2's transcript infrastructure.
- The messaging tool (or equivalent messaging mechanism) exists for user-to-agent communication and can trigger agent resume workflows.
- The worktree garbage collection process (Phase 2) respects activity timestamps — refreshing the mtime of a worktree prevents its cleanup.
- Content optimization state is recorded in transcript entries as part of Phase 2's message persistence, making it reconstructable on resume.
- Fork spawning and standard spawning share the same async lifecycle management infrastructure from Phase 2 — fork is a spawning optimization, not a different lifecycle model.
- Coordinator mode and non-interactive sessions are detectable at agent spawn time via existing session/context state without additional configuration.
- Agent progress tracking, summarization, and notification infrastructure is available from Phase 2's async agent lifecycle management.
- The agent name registry is initialized and maintained by the sub-agent spawning flow from Phase 2, with this feature consuming (not creating) the registry for re-engagement routing.
