# Implementation Plan: Message Rendering & Error Resilience

**Branch**: `016-message-rendering` | **Date**: 2026-05-21 | **Spec**: [spec.md](specs/016-message-rendering/spec.md)

**Input**: Feature specification from `specs/016-message-rendering/spec.md`

## Summary

Replace LiteAI's fragmented tool rendering system (15 per-tool components using 2 internal primitives: `InlineTool`/`BlockTool`) with a unified `DenseToolMessage` pattern adapted from Gemini CLI. Fix 4 confirmed bugs ("X undefined" toast, plan_enter model resolution, thinking collapse arrow, todowrite null render). Replace bordered-box toast with inline text. Unify all 17 tool types under a single 6-state status indicator. Changes span `packages/cli` and `packages/core`.

> [!NOTE]
> **Post-Research Scope Update**: One bug from the original roadmap was not found:
> - OpenTelemetry span leak in `llm.ts` — spans are in `plan.ts` instead, and are correctly guarded with try/finally.
>
> The `plan_enter` model resolution bug IS confirmed in `packages/core/src/tool/plan.ts:221`.
> See [research.md](specs/016-message-rendering/research.md) for details.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)

**Primary Dependencies**: `@liteai/ink` (Ink-based terminal rendering), `@liteai/sdk` (API client types), `@liteai/core` (multi-tenant HTTP/SSE backend), React (JSX rendering)

**Storage**: N/A (rendering layer only, no persistence changes)

**Testing**: Bun's built-in test runner (`bun test`), scoped to modified domains

**Target Platform**: Windows (primary dev), Node.js compatible terminal

**Project Type**: Monorepo — CLI terminal UI package (`packages/cli`) + core engine (`packages/core`)

**Performance Goals**: Non-blocking rendering, no regressions to SSE event throughput or TUI redraw frequency

**Constraints**: < 50ms per tool render cycle, zero new `any` escape hatches, zero backward compatibility concerns (Constitution I)

**Scale/Scope**: 17 tool types, ~1060 LOC in `tools.tsx` to refactor, 4 confirmed bug fix locations

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Architectural Purity | ✅ PASS | Breaking `InlineTool`/`BlockTool` primitives — clean break, no backward compat |
| II. Non-Blocking Performance | ✅ PASS | Rendering-only changes, no blocking operations introduced |
| III. Strict Type Safety | ✅ PASS | New `ToolDisplayStatus` enum and `mapToolState` function fully typed |
| IV. Fail-Fast Error Handling | ✅ PASS | Fixing silent fallbacks in `onSessionError` (was masking wrong shape) |
| V. Design-First Development | ✅ PASS | This plan serves as the design artifact (ADR) |
| VI. Test Integrity & Isolation | ✅ PASS | Scoped tests only, no global suite |
| VII. Incremental Scope | ✅ PASS | All changes scoped to message rendering pipeline |

**No violations. Gate passed.**

## Project Structure

### Documentation (this feature)

```text
specs/016-message-rendering/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── contracts/           # Phase 1 output (N/A — internal refactor)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/cli/src/tui/
├── components/
│   ├── tool-status-indicator.tsx      # [NEW] Unified ✓/✗/spinner/○/?/– status component
│   ├── error-message.tsx              # [NEW] ✗-prefixed persistent error message
│   ├── warning-message.tsx            # [NEW] ⚠-prefixed persistent warning message
│   ├── collapsed-group-view.tsx       # [MODIFY] Use status indicators, not raw text
│   ├── status-line.tsx                # [MODIFY] Clean model name, no error leak
│   └── shell-output.tsx               # [UNCHANGED] Kept for RunCommand sub-view
├── context/
│   └── toast.tsx                      # [MODIFY] Keep API, single-toast constraint
├── ui/
│   └── toast.tsx                      # [MODIFY] Remove borders, inline text rendering
├── routes/session/
│   ├── tools.tsx                      # [MAJOR REWRITE] Unified DenseToolMessage pattern
│   ├── parts.tsx                      # [MODIFY] Thinking display fix, dispatch update
│   └── message.tsx                    # [MODIFY] Error display improvements
├── state/
│   ├── app-state-events.ts            # [UNCHANGED] Error event shape already correct
│   └── app-state-context.tsx          # [MODIFY] Fix onSessionError shape extraction
├── constants/
│   └── tool-status.ts                 # [NEW] Status icon constants
└── utils/
    └── tool-display-status.ts         # [NEW] 4-state → 6-state mapper

packages/core/src/
└── tool/
    └── plan.ts                         # [MODIFY] Add ctx.extra.model fallback for plan_enter model resolution
```

**Structure Decision**: In-place modification of `packages/cli` and `packages/core`. No new packages. 5 new files in cli, 1 modification in core, ~10 modified files in cli.

## Post-Design Constitution Re-Check

*GATE: Re-evaluated after Phase 1 design completion.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Architectural Purity | ✅ PASS | Clean break — `InlineTool`/`BlockTool` eliminated entirely |
| II. Non-Blocking Performance | ✅ PASS | No blocking operations introduced in rendering |
| III. Strict Type Safety | ✅ PASS | `ToolDisplayStatus` enum, typed `ViewParts`, typed formatters |
| IV. Fail-Fast Error Handling | ✅ PASS | `onSessionError` fix removes silent fallback. `plan_enter` model resolution fix removes silent failure path. |
| V. Design-First Development | ✅ PASS | Plan + research + data-model artifacts produced before implementation |
| VI. Test Integrity & Isolation | ✅ PASS | Scoped tests only |
| VII. Incremental Scope | ✅ PASS | 1 out-of-scope bug correctly excluded (OTel span lifecycle in plan.ts is correct) |

**No violations. Post-design gate passed.**

## Complexity Tracking

No constitution violations to justify.
