# Implementation Plan: Plan Mode MVP Parity

**Branch**: `main` | **Date**: 2026-04-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/006-plan-mode-mvp-parity/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Refactor Plan Mode to eliminate the legacy dual-agent persona-swap architecture and achieve full behavioral parity with the `liteai_cli_mvp` reference implementation. The root agent remains continuous across plan/build transitions (zero amnesia). Plan mode entry requires user approval via `Question.ask()`. 5-phase workflow and interview mode instructions are ported from the MVP and injected as tool result output. Plan reminders fire during build phase (not plan phase). All legacy artifacts (persona files, inject patterns, stale prompts) are purged.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Bun 1.x runtime  
**Primary Dependencies**: ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), @opentelemetry/api, gray-matter  
**Storage**: SQLite (via drizzle-orm) for session persistence + in-memory `PlanModeStateRef` per session  
**Testing**: bun test (scoped: `bun test test/plan-mode/`)  
**Target Platform**: Node.js/Bun server (multi-tenant HTTP/SSE backend)  
**Project Type**: Library + HTTP server (packages/core)  
**Performance Goals**: Non-blocking event loop, minimal memory per session  
**Constraints**: Windows execution environment, Exit Code 1 expected on typecheck errors  
**Scale/Scope**: Changes scoped to ~12 files in `packages/core/src/` and `test/plan-mode/`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. v-Next Clean Break | ✅ PASS | Explicitly breaking legacy persona-swap. No shims. |
| II. Architecture & Performance | ✅ PASS | PlanModeStateRef is in-memory, non-blocking. No new DB overhead. |
| III. Tech Stack & Execution | ✅ PASS | Bun, TypeScript strict, `bun typecheck`, `bun lint:fix`. |
| IV. Variable & Linter Policy | ✅ PASS | Will analyze removed inject-related variables. |
| V. Design & Refactoring Guardrails | ✅ PASS | Changes scoped to plan mode domain. No global rewrites. |
| VI. Strict Error Handling | ✅ PASS | Fail-fast via PlanModeStateRef.for() + Question.RejectedError. |
| VII. Test Resolution | ✅ PASS | Tests updated for intentional architectural changes. |
| VIII. Architectural Design | ✅ PASS | 5 design decisions documented in research.md. |
| IX. Execution Gate | ✅ PASS | Planning mode — no code changes until user approves. |

**Gate result**: ALL PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/006-plan-mode-mvp-parity/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research findings & architecture decisions
├── data-model.md        # Phase 1: entity model & state transitions
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
packages/core/src/
├── agent/
│   └── agent.ts                    # MODIFY: Remove "plan-explore" from BUILTIN_AGENT_NAMES
├── bundled/
│   ├── agents/
│   │   ├── build.md                # UPDATE: Clean up stale comment references
│   │   ├── explore.md              # VERIFY: Against MVP EXPLORE_AGENT
│   │   ├── plan.md                 # REWRITE: primary→subagent, MVP system prompt
│   │   └── plan-explore.md         # DELETE: Dead code
│   └── prompts/
│       ├── misc/
│       │   ├── plan-workflow.md    # CREATE: 5-phase workflow (from MVP messages.ts)
│       │   └── plan-interview.md   # CREATE: Interview mode (from MVP messages.ts)
│       ├── tools/
│       │   └── plan-exit.txt       # REWRITE: Expanded from MVP ExitPlanModeV2Tool
│       └── system/
│           └── system.md           # UPDATE: Section 5 stale directives replaced
├── session/
│   └── engine/
│       └── plan-reminder.ts        # UPDATE: Invert guard (fire in build phase)
└── tool/
    └── plan.ts                     # REWRITE: Remove inject, add approval, add workflow

packages/core/test/
├── plan-mode/
│   ├── enter-plan-tool.test.ts     # UPDATE: New approval flow, no inject
│   ├── exit-plan-tool.test.ts      # UPDATE: No inject, plan-in-context
│   ├── plan-mode-state.test.ts     # VERIFY: Unchanged or minor updates
│   └── plan-reminder.test.ts       # UPDATE: Build-phase firing
└── session/engine/
    └── plan-reminder.test.ts       # UPDATE: Same as above (if different test)
```

**Structure Decision**: Single-package change in `packages/core`. No new packages, no new directories beyond `prompts/misc/` (which already exists). All work is within the existing `packages/core/src/` tree.

## Architecture Decisions

### ADR-001: User Approval via Question.ask()

**Context**: MVP uses `shouldDefer: true` to gate plan mode entry. LiteAI has no `shouldDefer` mechanism.

**Decision**: Use `Question.ask()` (already used by `PlanExitTool`) to present accept/decline options before mutating plan mode state.

**Rationale**: Same behavioral outcome. Proven, tested, already wired to UI. Adding a formal `shouldDefer` property to `Tool.Info` would require new infrastructure for a single use case.

### ADR-002: Workflow Text as Tool Result Output

**Context**: Model needs structured planning instructions upon entering plan mode.

**Decision**: Load `plan-workflow.md` or `plan-interview.md` at tool init time. Return as the `output` field of the `PlanEnterTool` result.

**Rationale**: Matches MVP pattern. Tool result text is high-priority model context. Simpler than per-turn attachment injection.

### ADR-003: Plan Reminder Guard Inversion

**Context**: Current reminders fire during plan mode (`active === true`). MVP fires during build mode.

**Decision**: Change guard from `if (!active) return` to `if (active || !planText) return`. Uses existing `planText` field as the "plan has been approved" signal.

**Rationale**: No new state fields needed. `planText` is already set by `PlanExitTool` on approval, making it the natural semantic flag.

### ADR-004: Interview Mode as Tool Parameter

**Context**: MVP uses `isPlanModeInterviewPhaseEnabled()` feature flag. Need to support both 5-phase and interview variants.

**Decision**: Add optional `interviewMode?: boolean` parameter to `PlanEnterTool`. Default: `false` (5-phase). Tool description instructs the agent on when to choose each variant.

**Rationale**: Per-invocation flexibility. Avoids global config for a per-task decision. The agent's tool description guides when to use each mode.

### ADR-005: Remove Inject, Keep State Events

**Context**: `PlanEnterTool` and `PlanExitTool` currently return `inject` messages with `agent: "plan"` / `agent: "build"` to trigger persona swaps.

**Decision**: Remove all `inject` returns. State mutations via `PlanModeStateRef.update()` + `Bus.publish(PlanStateChanged)` are the sole transition mechanism.

**Rationale**: The inject mechanism persists fake user messages with a different agent field, which the session engine uses to swap the root agent. This is the exact cause of amnesia. The state ref + event bus is the correct pattern — the UI already listens to `PlanStateChanged`.

## Change Map (Execution Order)

```text
Layer 1: Legacy Purge (FR-015a–g, SC-009)
  ├── 1a. DELETE plan-explore.md
  ├── 1b. REMOVE "plan-explore" from BUILTIN_AGENT_NAMES
  ├── 1c. REMOVE inject patterns from plan.ts (PlanEnterTool)
  ├── 1d. REMOVE inject patterns from plan.ts (PlanExitTool)
  ├── 1e. REMOVE getLastModel() helper (no longer needed)
  └── 1f. UPDATE build.md comments

Layer 2: MVP Prompt Porting (FR-016–020, C-004)
  ├── 2a. CREATE prompts/misc/plan-workflow.md
  ├── 2b. CREATE prompts/misc/plan-interview.md
  ├── 2c. REWRITE plan-exit.txt
  ├── 2d. UPDATE plan_enter description (inline in plan.ts)
  ├── 2e. REWRITE plan.md (subagent, MVP system prompt)
  ├── 2f. VERIFY explore.md against MVP EXPLORE_AGENT
  └── 2g. UPDATE system.md Section 5

Layer 3: Tool Behavior (FR-001–003, FR-009–010, FR-012–014)
  ├── 3a. PlanEnterTool: Add Question.ask() approval gate
  ├── 3b. PlanEnterTool: Add interviewMode parameter
  ├── 3c. PlanEnterTool: Load & return workflow text as output
  ├── 3d. PlanExitTool: Remove inject, keep approval + plan-in-context
  └── 3e. Both: Cleanup removed helper functions

Layer 4: Plan Reminder (FR-011)
  └── 4a. Invert guard condition in plan-reminder.ts

Layer 5: Test Updates (VII)
  ├── 5a. enter-plan-tool.test.ts — approval flow, no inject, workflow text
  ├── 5b. exit-plan-tool.test.ts — no inject, plan-in-context output
  ├── 5c. plan-reminder.test.ts — build-phase firing
  └── 5d. typecheck + lint

Layer 6: Legacy Verification (C-007, SC-009)
  └── 6a. Full codebase search for residual patterns
```

## Complexity Tracking

> No constitution violations to justify.

| Aspect | Complexity | Notes |
|--------|-----------|-------|
| Files modified | ~12 | Scoped to plan mode domain |
| Files deleted | 1 | plan-explore.md (dead code) |
| Files created | 2 | plan-workflow.md, plan-interview.md |
| New dependencies | 0 | None |
| Schema changes | 0 | PlanModeState unchanged |
| API surface changes | 0 | Tool IDs, SSE events unchanged |
| Breaking changes | 1 | Plan mode persona swap behavior (intentional v-next break) |
