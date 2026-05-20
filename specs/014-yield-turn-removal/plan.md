# Implementation Plan: yield_turn Removal & State Cleanup

**Branch**: `014-yield-turn-removal` | **Date**: 2026-05-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/014-yield-turn-removal/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Systematically remove all deprecated `yield_turn` tool infrastructure and associated
legacy plan mode state emissions from `packages/core`. This is Phase 3 of the
core-roadmap roadmap. The blocking subagent architecture from Phase 2 fully
supersedes `yield_turn`, making it dead code. The cleanup eliminates dead code paths,
removes stale event definitions, and deletes obsolete prompt files — establishing a
clean baseline for Phase 4 (Prompt Rewrites) and Phase 6 (KV Cache Hardening).

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode, Bun runtime)

**Primary Dependencies**: Bun test runner, Zod 4.1.8, OpenTelemetry tracing, @ai-sdk/provider

**Storage**: SQLite via Drizzle ORM (session persistence); in-memory `PlanModeStateRef` registry (hot path)

**Testing**: `bun test` (Bun built-in runner), scoped to `test/plan-mode`, `test/session`, `test/tools`

**Target Platform**: Windows development, Linux production (Node.js-compatible APIs)

**Project Type**: Multi-tenant HTTP/SSE backend monorepo (`packages/core`)

**Performance Goals**: Zero overhead — this is a deletion feature; net-negative code and prompt token budget

**Constraints**: Must maintain zero regressions in plan_enter → subagent → plan_exit → approve workflow

**Scale/Scope**: 15 yield_turn references across 8 source files; 6 PlanStateChanged references across 6 files; 3 files deleted; 2 CLI files cleaned

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Architectural Purity | ✅ PASS | Pure deletion of deprecated code; no backward compat preserved |
| II | Non-Blocking Performance | ✅ PASS | Removes event emission overhead on plan state transitions |
| III | Strict Type Safety | ✅ PASS | `bun typecheck` + `bun lint:fix` verification required at each phase |
| IV | Fail-Fast Error Handling | ✅ PASS | No new fallbacks introduced; removing dead code only |
| V | Design-First Development | ✅ PASS | Full research + plan artifacts produced before implementation |
| VI | Test Integrity & Isolation | ✅ PASS | Test files with PlanStateChanged refs must be updated, not blindly removed |
| VII | Incremental Scope | ✅ PASS | Scoped strictly to Phase 3; stop-drift retention is a scope decision, not creep |

**Post-Design Re-Check**: All gates remain ✅. Research revealed PlanModeState is
already clean (P2 work), narrowing Phase 3B scope. StopDriftService is retained per
Decision 3 in research.md — it's P2-era code, not legacy.

## Project Structure

### Documentation (this feature)

```text
specs/014-yield-turn-removal/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output — full codebase audit
├── data-model.md        # Phase 1 output — entity state transitions
├── quickstart.md        # Phase 1 output — verification steps
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/core/
├── src/
│   ├── acp/
│   │   └── events.ts                        # Remove PlanStateChanged subscription
│   ├── agent/
│   │   └── filter.ts                        # Remove yield_turn from ALL_LITEAI_TOOLS
│   ├── bundled/prompts/
│   │   ├── misc/
│   │   │   └── plan-active-reminder.md      # DELETE
│   │   └── tools/
│   │       └── yield_turn.txt               # DELETE
│   ├── coordinator/
│   │   ├── coordinator-mode.ts              # Remove yield_turn from tool arrays
│   │   ├── coordinator-prompt.ts            # Remove yield_turn from prompt text
│   │   └── teammate-runner.ts              # Remove yield_turn from worker prompt
│   ├── session/
│   │   ├── index.ts                         # Remove PlanStateChanged event definition
│   │   ├── plan-mode-state.ts               # Remove PlanStateChanged emission from update()
│   │   └── engine/
│   │       ├── plan-reminder.ts             # Remove injectActivePlanReminder + dispatch branch
│   │       └── query.ts                     # Remove yield_turn detection block
│   └── tool/
│       ├── yield_turn.ts                    # DELETE
│       ├── index.ts                         # Remove yield_turn export
│       ├── registry.ts                      # Remove YieldTurnTool import + array entry
│       └── agent.ts                         # Remove yield_turn result parsing
└── test/
    ├── plan-mode/
    │   ├── plan-mode-state.test.ts          # Update PlanStateChanged assertions
    │   └── enter-plan-tool.test.ts          # Update PlanStateChanged assertions
    └── session/
        └── plan-mode-state.test.ts          # Update PlanStateChanged assertions
```

```text
packages/cli/
└── src/tui/state/
    ├── app-state-events.ts              # Remove plan.state_changed event handler
    └── app-state.ts                     # Remove PlanState interface, plan/prePlanPermissionMode fields
```

**Structure Decision**: No structural changes — modifications and deletions within the existing
`packages/core/src/` tree. Test files updated in-place.

## Complexity Tracking

No constitution violations — no complexity tracking needed.
