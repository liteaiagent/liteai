# Implementation Plan: Plan Mode

**Branch**: `004-plan-mode` | **Date**: 2026-04-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-plan-mode/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Reference Implementation Mandate

All work — specification, planning, task decomposition, design decisions, code implementation, and code reuse — MUST be grounded on the MVP reference implementation at `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\src`. The target is **same or superior** quality and behavioral parity; no degradation from MVP is acceptable.

Key reference files:
- `tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts` — approval flow, plan-in-context injection, tool result construction
- `tools/EnterPlanModeTool/EnterPlanModeTool.ts` — build-to-plan transition, state mutation
- `tools/ExitPlanModeTool/prompt.ts` and `tools/EnterPlanModeTool/prompt.ts` — tool descriptions
- `state/AppStateStore.ts` — `planModeState` fields, state mutation patterns
- `utils/attachments.ts` — reminder cycle logic (sparse every turn, full every N turns)

## Summary

Refactor plan mode from synthetic message injection to an attachment-driven state machine with persistent `PlanModeState`, sparse/full reminder cycles via in-memory user message parts, `ExitPlanModeTool` with SSE-based approval gate and plan-in-tool-result injection, `EnterPlanModeTool` for bidirectional mode transitions, and `disallowedTools` enforcement in `ToolRegistry.tools()` for read-only Plan/Explore sub-agents.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Bun 1.x runtime
**Primary Dependencies**: ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), effect, remeda, @opentelemetry/api
**Storage**: SQLite via drizzle-orm (session persistence, PlanModeState as JSON column)
**Testing**: bun test --timeout 90000 (scoped to modified domains)
**Target Platform**: Multi-tenant HTTP/SSE backend server (Bun runtime)
**Project Type**: Library / backend service (`@liteai/core`)
**Performance Goals**: Non-blocking query loop, minimal per-turn overhead (no DB writes for reminders)
**Constraints**: Session-scoped state (no process globals), prompt cache preservation (C-002), zero regression on existing agents (C-003)
**Scale/Scope**: Multi-tenant, concurrent sessions

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Zero Backward Compat | ✅ PASS | Breaking current plan-reminder.ts (synthetic parts) is authorized |
| II. Architecture & Performance | ✅ PASS | Session-scoped state, non-blocking, no process globals |
| III. Tech Stack | ✅ PASS | Bun, drizzle-orm, TypeScript strict mode |
| IV. Linter Policy | ✅ PASS | Will analyze unused variables before suppressing |
| V. Design Guardrails | ✅ PASS | Scoped to plan mode; no unprompted rewrites |
| VI. Fail-Fast Protocol | ✅ PASS | Typed errors: RejectedError, empty plan validation |
| VII. Test Resolution | ✅ PASS | Will analyze failures before modifying tests |
| VIII. Design Protocol | ✅ PASS | This plan is the structured design phase |
| IX. Execution Gate | ✅ PASS | Planning mode; user authorization required |

**Post-Phase 1 re-check**: ✅ All gates still pass. Design uses session-scoped state, attachment-based injection, and Bus events — all consistent with constitution principles.

## Project Structure

### Documentation (this feature)

```text
specs/004-plan-mode/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── plan-mode-api.md # Phase 1 output — interface contracts
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── session/
│   ├── engine/
│   │   ├── query.ts               # MODIFY: Wire PlanModeState read, turn counter, pass to reminder
│   │   └── plan-reminder.ts       # REWRITE: Attachment-based, read PlanModeState, no DB writes
│   ├── index.ts                   # MODIFY: Add plan mode state accessors to Session namespace
│   ├── session.sql.ts             # MODIFY: Add plan_mode JSON column
│   ├── events.ts                  # MODIFY: Add plan mode BusEvent types (informational only)
│   └── plan-mode-state.ts         # NEW: PlanModeState type, factory, read/write helpers
├── tool/
│   ├── plan.ts                    # REWRITE: ExitPlanModeTool, restore EnterPlanModeTool
│   └── registry.ts                # MODIFY: Add disallowedTools deny filter
├── agent/
│   ├── agent.ts                   # MODIFY: Add plan-explore to BUILTIN_AGENT_NAMES, wire normalizeToolNames() for disallowedTools/tools
│   └── filter.ts                  # NO CHANGE: resolveAgentTools already handles disallowedTools via exact ID match
├── platform/
│   ├── profile.ts                 # MODIFY: Add toolNameMap field to PlatformProfile, add normalizeToolNames() utility
│   └── profiles/
│       └── claude.ts              # MODIFY: Add toolNameMap with Claude Code → liteai canonical ID mappings
├── acp/
│   └── events.ts                  # MODIFY: Route plan mode BusEvents to SSE
├── bundled/
│   └── agents/
│       └── plan-explore.md        # NEW: Plan/Explore sub-agent definition
└── question/                      # NO CHANGE: Question.ask() used as-is

tests/
├── plan-mode/
│   ├── plan-mode-state.test.ts    # NEW: PlanModeState CRUD
│   ├── plan-reminder.test.ts      # REWRITE: Attachment-based reminder tests
│   ├── exit-plan-tool.test.ts     # NEW: ExitPlanModeTool approval flow
│   └── enter-plan-tool.test.ts    # NEW: EnterPlanModeTool transitions
├── tool/
│   └── registry.test.ts           # MODIFY: disallowedTools regression tests
└── agent/
    └── filter.test.ts             # NO CHANGE unless needed for coverage
```

**Structure Decision**: Single project (packages/core), extending the existing directory structure. No new top-level directories needed. The `plan-mode-state.ts` module is co-located with session infrastructure because PlanModeState is persisted as a session column.

## Complexity Tracking

No constitution violations detected — this table is empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| — | — | — |
