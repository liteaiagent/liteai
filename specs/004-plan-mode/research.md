# Research: Plan Mode

**Feature Branch**: `004-plan-mode` | **Date**: 2026-04-15 | **Spec**: [spec.md](./spec.md)

## R-001: PlanModeState Persistence Strategy

**Decision**: JSON column on the existing `session` SQLite table via drizzle-orm migration.

**Rationale**: The spec clarification (2026-04-15) explicitly mandates "SQLite session metadata — persisted as a JSON column on the session row, consistent with existing session persistence." This is the lightest-touch schema change — a single nullable `text({ mode: "json" })` column holding a `PlanModeState` object. It co-locates plan mode state with the session it belongs to (no join), matches the existing pattern for `permission` and `revert` columns, and survives process restarts.

**Alternatives Considered**:
- **Separate `plan_mode_state` table**: Rejected — adds a join for every query loop turn read, and plan mode state has a 1:1 relationship with sessions (no cardinality benefit from normalization).
- **In-memory only (Map<SessionID, PlanModeState>)**: Rejected — doesn't survive process restarts. Session resume (Phase 4 infrastructure) would lose the turn counter.
- **JSON sidecar file on disk**: Rejected — adds file I/O per turn. SQLite is already the persistence layer for sessions.

## R-002: Attachment Injection Mechanism

**Decision**: In-memory part append (non-persistent) on the user message, following the established pattern in `query.ts:226-250` (critical system reminder injection).

**Rationale**: The current `plan-reminder.ts` persists synthetic parts via `Session.updatePart()`, which writes to SQLite on every turn. This wastes DB I/O and pollutes the transcript with ephemeral reminder text. The spec requires "a non-synthetic user message part appended by the reminder system" (FR-004). The critical system reminder injection pattern in `query.ts` already demonstrates how to append parts to the last user message in-memory without DB writes — this is the proven integration point.

**Alternatives Considered**:
- **System prompt injection**: Rejected by C-002 — must not modify the static prompt. Also breaks prompt cache.
- **Separate "attachment" message type**: Rejected — MVP uses attachments as separate message objects, but liteai's message model is different (parts on existing messages). Introducing a new message type is unnecessary complexity.
- **Persisted synthetic parts (current approach)**: Rejected by spec — pollutes transcript, breaks cache, violates C-002 intent.

## R-003: SSE Event Emission for Plan Mode

**Decision**: Define two new `BusEvent` types in the session events module and route them through the existing ACP SSE event infrastructure.

**Rationale**: The project uses `Bus.publish()` + `BusEvent.define()` for internal eventing (see `Session.Event.Created`, `Session.Event.Updated`, etc.). ACP (`acp/events.ts`) subscribes to Bus events and relays them as SSE to connected clients. Adding two new BusEvents (`plan.state_changed`, `plan.approval_requested`) follows the established pattern with zero architectural change.

**Alternatives Considered**:
- **Direct SSE emission from tool code**: Rejected — bypasses the Bus abstraction, makes testing harder, and couples tool implementation to SSE transport.
- **WebSocket push**: Rejected — project uses SSE exclusively. Adding WebSocket for a single feature is unjustified complexity.

## R-004: Approval Gate Implementation

**Decision**: Reuse the existing `Question.ask()` infrastructure (already used by the current `PlanExitTool`).

**Rationale**: `Question.ask()` (in `question/index.ts`) is a proven blocking RPC mechanism that suspends the query loop until the client responds. The current `PlanExitTool` already uses it. The spec's approval gate behavior (block model execution until user approves/rejects) maps perfectly to `Question.ask()` semantics. The only difference is the SSE event: the new implementation emits `plan.approval_requested` as a Bus event before calling `Question.ask()`, giving clients the plan text for rich rendering.

**Alternatives Considered**:
- **Custom Deferred/Promise mechanism**: Rejected — reimplements what Question.ask() already does.
- **Polling-based approval**: Rejected — adds latency and complexity vs. the blocking RPC model.

## R-005: disallowedTools Enforcement Integration Point

**Decision**: Wire `resolveAgentTools()` from `agent/filter.ts` into `ToolRegistry.tools()` as the final filter step.

**Rationale**: `resolveAgentTools()` already handles `disallowedTools` deny-filter logic (filter.ts:116-129), including wildcard prefix matching. `ToolRegistry.tools()` already receives the `agent` parameter (registry.ts:80). The gap is simply that `ToolRegistry.tools()` never calls `resolveAgentTools()` — the function exists but isn't wired in. The fix is a single post-assembly filter step.

**Alternatives Considered**:
- **Duplicate deny-filter logic inline in ToolRegistry**: Rejected — violates DRY. `resolveAgentTools` already handles edge cases (wildcards, empty arrays).
- **Filter at agent config load time**: Rejected — tool availability can be model-dependent (patch format filtering), so it must be resolved at runtime.

## R-006: Plan/Explore Sub-Agent Definition Pattern

**Decision**: Define Plan/Explore sub-agent configurations via bundled `.md` agent definition files with YAML frontmatter, following the existing pattern for `plan`, `build`, `explore`, `compaction`, etc.

**Rationale**: All built-in agents are loaded via `loadBuiltinAgents()` from bundled `.md` files with gray-matter frontmatter (agent.ts:26-42). Adding `plan-explore` follows this established pattern. The agent definition includes `omitLiteaiMd: true`, `mode: "subagent"`, and `disallowedTools: ["edit", "write", "multiedit", "apply_patch"]`.

**Alternatives Considered**:
- **Programmatic agent definition**: Rejected — inconsistent with the declarative `.md` frontmatter pattern used by all other agents.
- **User-config-only (no built-in)**: Rejected — Plan/Explore agents are system-level infrastructure, not user customization.

## R-007: MVP Behavioral Parity Mapping

**Decision**: Adapt MVP patterns from CLI process-global state to session-scoped state with these mappings:

| MVP Pattern | LiteAI Adaptation |
|---|---|
| `AppState.toolPermissionContext.mode === 'plan'` | `PlanModeState.active === true` (session-scoped) |
| `handlePlanModeTransition()` process-global | Session-scoped state mutation via `setPlanModeState()` |
| `setNeedsPlanModeExitAttachment(true)` global flag | Inline in ExitPlanModeTool: inject plan into tool result |
| Attachment message objects in message history | In-memory user message parts (non-persistent) |
| Turn counting via message array scan | Persistent `turnsSincePlanReminder` counter in PlanModeState |
| `mapToolResultToToolResultBlockParam()` for plan text | Tool `execute()` return value with plan text in output |

**Rationale**: The MVP is a single-process CLI application. Every adaptation must preserve behavioral equivalence while respecting the multi-tenant, session-scoped architecture. The key insight is that MVP's process-global state maps to session-scoped state stored in SQLite, and MVP's in-memory attachment messages map to in-memory user message parts.
