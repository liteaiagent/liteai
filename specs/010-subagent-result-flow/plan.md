# Implementation Plan: Subagent Result Flow

**Branch**: `main` | **Date**: 2026-05-04 | **Spec**: [spec.md](file:///d:/liteai/specs/010-subagent-result-flow/spec.md)
**Input**: Feature specification from `/specs/010-subagent-result-flow/spec.md`

## Summary

The goal of this feature is to eliminate database reads for inter-loop communication when a parent agent delegates a task to a subagent. Currently, the parent reads the child's final state from the database. We will refactor the engine to directly pass the child's `SessionResult` (returned by `runSession()`) back to the parent via the call stack, achieving a pure forward-only execution model while retaining persistence through the Checkpointer for history and SSE streaming.

## Technical Context

**Language/Version**: TypeScript 5+ (Bun ecosystem)  
**Primary Dependencies**: Vercel AI SDK (`ai`), `bun`  
**Storage**: SQLite (abstracted via Checkpointer interface)  
**Testing**: `bun test`  
**Target Platform**: Node.js/Bun server environment  
**Project Type**: Core engine library (`packages/core`)  
**Performance Goals**: Non-blocking concurrent agent execution, zero mid-loop DB reads  
**Constraints**: Follow fail-fast protocol, strict typing, no unhandled promises  
**Scale/Scope**: Refactoring focused on `loop.ts`, `query.ts`, and `streaming-tool-executor.ts` within the `packages/core/src/session/engine` module.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **0. Break Backward Compatibility**: Authorized. The return signature usage of subagents will change.
- **1. Architecture**: Enhances strictly non-blocking architecture by removing DB I/O from the loop's hot path.
- **4. Design > Speed**: Aligns with the strategic "forward-only loop" decoupling pattern.
- **5. Strict Error Handling**: Eliminates fire-and-forget `Bus.publish` for child errors; errors are now returned and handled explicitly.

## Project Structure

### Documentation (this feature)

```text
specs/010-subagent-result-flow/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── session/engine/
│   └── loop.ts                   # [MODIFIED] Exported runSubagent() with direct SessionResult return
└── tool/
    └── task.ts                   # [MODIFIED] In-memory message lookup + runSubagent invocation

Verified clean (no changes needed):
├── session/engine/query.ts
└── session/engine/streaming-tool-executor.ts
```

**Structure Decision**: Code modifications will be strictly confined to the existing `packages/core/src/session/engine/` module, specifically targeting the orchestration and tool execution paths that handle subagents.

## Complexity Tracking

No violations of core mandates or architectural principles. The changes explicitly reduce system complexity by removing side-channel data flow.
