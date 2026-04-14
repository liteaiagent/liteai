# Research: Fork Subagent + Agent Durability

**Feature**: 003-fork-subagent-durability
**Date**: 2026-04-14

## MVP Grounding

> All research decisions are grounded on the MVP reference implementation at `liteai_cli_mvp/src`. When the MVP provides a working pattern, it is adopted unless a multi-tenant adaptation provably improves it. Deviation from MVP must be explicitly justified.

---

## R-001: Session-Scoped CacheSafeParams Storage

**Question**: The MVP stores `lastCacheSafeParams` as a module-level global variable. How should this be adapted for a multi-tenant backend where multiple sessions run concurrently?

**Decision**: Store CacheSafeParams as a property on the session's engine context (accessible via the Session module), scoped per-session and per-turn.

**Rationale**: A module-level global would leak cache parameters across tenants — a parent in Tenant A's session could pollute the cache slot read by a post-turn fork in Tenant B's session. Session-scoped storage via the existing session state mechanism provides tenant isolation with zero additional infrastructure.

**Alternatives considered**:
- AsyncLocalStorage slot: Would require threading ALS context into post-turn hooks, which may not have the parent's ALS context available.
- WeakMap keyed by session object: Correct isolation but awkward lifecycle management. Session state is already the canonical storage mechanism.

**MVP Reference**: `utils/forkedAgent.ts:73-81` — `saveCacheSafeParams()` / `getLastCacheSafeParams()`

---

## R-002: Fork Feature Gate Mechanism

**Question**: The MVP uses `feature('FORK_SUBAGENT')` from a bundler-injected flag. How should the fork feature gate work in LiteAI?

**Decision**: Use the existing `Config` system with an environment variable fallback (`LITEAI_FORK_SUBAGENT=1`). The gate function checks: (1) config flag enabled, (2) NOT coordinator mode, (3) NOT non-interactive session.

**Rationale**: LiteAI already has a config system and environment variable patterns. The bundler-injected `feature()` flag is a CLI-specific pattern that doesn't exist in the backend. Using config + env aligns with existing infrastructure.

**Alternatives considered**:
- Dedicated `Flag` module: Overly complex for a single feature flag. Can be added if more flags accumulate (roadmap candidate per §V).
- Hardcoded to always-on: Removes the ability to disable fork spawning per deployment. Counter to the spec's FR-004 gate requirements.

**MVP Reference**: `tools/AgentTool/forkSubagent.ts:32-39` — `isForkSubagentEnabled()`

---

## R-003: Fork Recursion Detection Mechanism

**Question**: How should fork recursion be detected in LiteAI's message format?

**Decision**: Inject a sentinel XML tag (`<fork_boilerplate>`) into the fork child's behavioral contract message. Detection scans the transcript's user messages for the tag presence.

**Rationale**: Matches MVP pattern exactly (`FORK_BOILERPLATE_TAG`). The tag is embedded in the behavioral contract text block, so any fork child's transcript will contain it. Scanning is O(n) over messages but n is bounded by the 200-turn limit. The tag approach is simpler and more reliable than maintaining an "isFork" flag that could be lost during resume.

**Alternatives considered**:
- Context metadata flag (`isFork: true`): Would need to be persisted and reconstructed on resume. The tag is self-documenting in the transcript.
- Agent type check: Fork children have `agentType: 'fork'` in metadata, but this isn't available in the message stream during recursion detection at spawn time.

**MVP Reference**: `tools/AgentTool/forkSubagent.ts:78-89` — `isInForkChild()`

---

## R-004: Orphaned Message Filtering Strategy

**Question**: How should orphaned messages be filtered from transcripts on resume?

**Decision**: Three composable filter functions, applied in sequence:
1. `filterUnresolvedToolUses()` — Remove assistant messages with tool_use blocks that have no matching tool_result in subsequent user messages
2. `filterOrphanedThinkingOnlyMessages()` — Remove assistant messages that contain only thinking blocks (no text, no tool_use)
3. `filterWhitespaceOnlyAssistantMessages()` — Remove assistant messages where all text content is whitespace

**Rationale**: Matches MVP's three-filter pipeline exactly. The order matters: tool use filtering first removes incomplete exchanges, then thinking-only removes stale reasoning, then whitespace removes empty padding. Composable design allows reuse in transcript compaction.

**Alternatives considered**:
- Single-pass filter: Would be more efficient but harder to test and maintain. The three-pass approach is clear about what each filter does.
- Transcript validation before recording: Would prevent orphans at write time, but can't handle crash-interrupted writes where the process dies mid-stream.

**MVP Reference**: `tools/AgentTool/resumeAgent.ts:70-74` — filter pipeline

---

## R-005: Content Optimization State Reconstruction

**Question**: How should content optimization state (tool result previews/disk persistence) be reconstructed for cache stability on resume?

**Decision**: Reconstruct from transcript records by scanning the resumed messages for tool_result blocks that reference persisted content. Use the parent's live optimization state to gap-fill entries that the fork child inherited but never persisted as new records.

**Rationale**: Matches MVP's `reconstructForSubagentResume()` pattern. The key insight is that fork children inherit the parent's optimization state at spawn time, but only persist *new* optimization decisions. On resume, the child needs both inherited and new decisions to produce cache-identical wire prefixes. Gap-filling from the parent's live state covers the inherited entries.

**Alternatives considered**:
- Full optimization state persistence at spawn time: Would make resume self-contained but increases disk I/O. The gap-fill approach is more efficient.
- Skip optimization state on resume: Would cause cache misses due to divergent wire prefixes. Unacceptable for SC-012.

**MVP Reference**: `utils/toolResultStorage.ts` — `reconstructForSubagentResume()`

---

## R-006: Worktree Mtime Refresh Timing

**Question**: When should a resumed agent's worktree mtime be refreshed to prevent GC races?

**Decision**: Refresh mtime BEFORE the agent begins execution, immediately after worktree validation (stat check). This prevents a race condition where the GC process scans the worktree between validation and first agent activity.

**Rationale**: Matches MVP pattern in `resumeAgent.ts:93-97`. The refresh must happen synchronously in the resume flow, not deferred to the agent's first tool call. The GC process checks mtime to determine staleness — a stale mtime during the gap between validation and first activity could trigger deletion.

**Alternatives considered**:
- Refresh at first tool call: Creates a race window. Agent startup (context construction, model resolution) can take seconds.
- GC exclusion list: Adds coordination between GC and resume that doesn't exist in the current architecture.

**MVP Reference**: `tools/AgentTool/resumeAgent.ts:93-97` — mtime bump

---

## R-007: Fork Child Tool Pool Identity

**Question**: Should fork children receive the parent's exact tool pool or a re-filtered subset?

**Decision**: Fork children receive the parent's **exact tool pool** (including the agent tool itself). Fork recursion is blocked at call time via the `isInForkChild()` guard, not by removing the tool from the pool.

**Rationale**: Tool definitions are part of the cache key for the upstream provider. Removing the agent tool from the fork child's pool would change the `tools` parameter in the API request, invalidating the shared cache. The MVP makes this explicit: `tools: ['*']` with `useExactTools: true`.

**Alternatives considered**:
- Remove agent tool from fork child's pool: Simpler but breaks cache sharing (different tool definitions → cache miss). Rejected for SC-001 violation.

**MVP Reference**: `tools/AgentTool/forkSubagent.ts:47-71` — `tools: ['*']` with cache-identical comment

---

## R-008: System Prompt Re-Threading on Fork Resume

**Question**: When a fork child is resumed, how should the parent's system prompt be obtained?

**Decision**: Three-tier fallback:
1. Use the parent's live rendered system prompt if available from the parent context
2. If unavailable, rebuild from the session's current configuration
3. If reconstruction fails, throw an explicit error (fail-fast, no proceeding with mismatched prompt)

**Rationale**: Exact match of MVP's `resumeAgent.ts:116-148`. The first tier is the fast path (parent context is available during normal operation). The second tier handles edge cases where the parent context was lost. The third tier prevents silent cache corruption.

**Alternatives considered**:
- Always rebuild: Could produce divergent prompts due to dynamic state (feature flags, time-dependent content). Rejected for SC-012 violation.
- Persist rendered prompt in agent metadata: Would make resume self-contained but adds ~10KB per agent to disk. The parent context is almost always available.

**MVP Reference**: `tools/AgentTool/resumeAgent.ts:116-148` — three-tier system prompt resolution

---

## R-009: Permission Mode Composition for Fork Children

**Question**: How should the fork child's permission mode interact with the parent's elevated permission modes?

**Decision**: Elevated parent permission modes (`bypassPermissions`, `acceptEdits`, `auto`) override the fork child's default `bubble` mode. If the parent session has already opted into a permissive mode, the fork child inherits that mode rather than forcing interactive prompts for background workers.

**Rationale**: This is explicit in the spec (FR-001) and matches MVP behavior. A parent in `auto` mode has already authorized non-interactive execution. Forcing the fork child to `bubble` would surface permission prompts to the parent terminal for every tool call, defeating the purpose of background execution.

**Alternatives considered**:
- Always use `bubble` regardless of parent: Would make fork children interactive even when the parent has explicitly opted out of prompts. Breaks the background worker UX.
- Inherit parent mode unconditionally: Would skip the `bubble` default in cases where the parent hasn't opted into a permissive mode. The composition rule provides the right default with the right escape hatch.

**MVP Reference**: `tools/AgentTool/resumeAgent.ts:158-161` — worker permission context override

---

## R-010: Async Agent Spawn Mode with Fork Enabled

**Question**: Should fork spawning force all agent spawns into async mode?

**Decision**: Yes — when fork spawning is enabled, ALL agent spawns (not just fork-specific ones) are forced into async mode for a unified task-notification interaction model.

**Rationale**: Matches FR-005 and MVP behavior. Mixing sync and async spawn paths when fork is active would create an inconsistent UX where some agents return inline results and others produce task notifications. Unifying on async ensures the parent always sees `<task-notification>` interactions, which is the correct model for background workers.

**Alternatives considered**:
- Only force fork spawns to async: Would leave standard sub-agents as sync, creating inconsistent behavior. The parent would need to handle two different interaction patterns.
- Config option for per-agent sync/async: Over-complexity for a feature that works well with unified async.

**MVP Reference**: `tools/AgentTool/forkSubagent.ts:27-28` — "All agent spawns run in the background (async)" comment
