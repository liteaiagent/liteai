# Engine Decoupling: Overview & Competitive Analysis

> **Status**: Approved for implementation
> **Date**: 2026-04-27
> **Supersedes**: `roadmap/engine-orchestration-redesign-rfc.md` (Reactor Pattern — superseded by simpler approach based on competitive analysis)
> **Scope**: `packages/core/src/session/engine/` — `loop.ts`, `query.ts`, `persister.ts`, `events.ts`, `tools.ts`
> **Related tools**: `packages/core/src/tool/yield_turn.ts`, `packages/core/src/agent/filter.ts`

---

## 1. Background & Motivation

The session engine (`loop.ts` + `query.ts` + `persister.ts`) is a ~2,300-line monolithic orchestrator with three structural problems:

1. **`yield_turn` as UX artifact**: The `yield_turn` tool renders as a raw tool call in the UI. It exists solely because we use `toolChoice: "required"`, forcing the model to always call a tool — including when it wants to stop.

2. **DB persistence coupled to engine loop**: `EventPersister` calls `Session.updatePart()` and `Session.updateMessage()` synchronously during event processing. This means the engine cannot run without a database, and persistence failures crash the engine.

3. **Monolithic concern mixing**: Stop-drift recovery, loop detection, plan mode enforcement, compaction triggers, and error classification are all interleaved in `loop.ts` and `persister.ts` with no clear boundaries.

### Why We're Revisiting the Old RFC

The previous RFC (`engine-orchestration-redesign-rfc.md`) proposed a **Reactor Pattern** with an `EngineReactor` class and named dispatch handlers. After auditing three production agent systems (Gemini CLI, Claude Code, LangGraph), we found that **none of them use middleware, event pipelines, or reactor abstractions**. They all use simpler patterns that work at scale. We're adopting those proven patterns instead.

---

## 2. Competitive Analysis Summary

### 2.1 Turn Termination: How Does the Model Say "I'm Done"?

| System | `toolChoice` | How model stops | "Done" tool? |
|--------|-------------|----------------|-------------|
| **LangGraph** | `auto` | Returns text with no `tool_calls` → graph routes to `END` | ❌ |
| **Gemini CLI** | `auto` | `finishReason: STOP` with no `pendingToolCalls` | ❌ |
| **Claude Code** | `auto` (`undefined`) | No `tool_use` blocks in response → `needsFollowUp = false` | ❌ |
| **LiteAI** | **`required`** ⚠️ | Model calls `yield_turn` tool | ✅ `yield_turn` |

**Finding**: We are the only system using `toolChoice: required` or a "done" tool.

### 2.2 Stop-Drift Safety Nets

| System | Approach | Implementation |
|--------|----------|---------------|
| **LangGraph** | None | Trusts model completely |
| **Gemini CLI** | Post-stop LLM verification | `nextSpeakerChecker` — separate cheap LLM call asking "should user or model speak next?" |
| **Claude Code** | Post-stop hooks | `handleStopHooks()` — runs validation hooks after natural stop, injects blocking errors if needed |
| **LiteAI** | Pre-emptive forced tooling | `toolChoice: required` + correction messages on bare stop |

**Finding**: SOTA tools use post-hoc validation (cheap), not pre-emptive constraint (expensive).

### 2.3 Engine Architecture

| System | Pattern | Lines | Middleware/Pipeline? | DB in hot path? |
|--------|---------|-------|---------------------|----------------|
| **LangGraph** | Declarative graph | ~1,000 | Graph nodes ARE the pipeline | `CheckpointSaver` — external |
| **Gemini CLI** | Recursive generators | ~2,600 | ❌ Monolithic class + services | `ChatRecordingService` — async |
| **Claude Code** | Flat while loop | ~1,730 | ❌ Single function | Generator yields upward — consumer persists |
| **LiteAI** | Generator + consumer | ~2,300 | ❌ (proposed but rejected) | Synchronous `Session.updatePart()` in hot path ⚠️ |

**Finding**: No SOTA tool uses middleware or event pipeline abstractions. Complexity is managed through service extraction (separate classes with clear interfaces) and generator composition (pure producers, consumers handle side effects).

### 2.4 Reference Code Locations

For the implementing agent, the reference codebases are:

- **Gemini CLI**: `C:\Users\aghassan\Documents\workspace\gemini-cli\packages\core\src\`
  - `core/client.ts` — main engine loop (1,283 lines)
  - `core/turn.ts` — single-turn async generator (448 lines)
  - `scheduler/scheduler.ts` — tool execution orchestrator (940 lines)
  - `utils/nextSpeakerChecker.ts` — post-stop LLM verification (138 lines)

- **Claude Code MVP**: `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\`
  - `query.ts` — monolithic query loop (1,730 lines)

- **LangGraph JS**: `C:\Users\aghassan\Documents\workspace\langgraphjs\`
  - `libs/langgraph-core/src/prebuilt/react_agent_executor.ts` — ReAct agent (1,012 lines)

---

## 3. Decisions Made

### D1: Drop `toolChoice: required`, switch to `auto`
- Default `toolChoice` to `"auto"` matching all three reference implementations.
- Keep `toolChoice: "required"` available as an agent-level config override for subagents or weak models.
- We have telemetry data to validate which models currently produce premature stops.

### D2: Keep `yield_turn` for now (subagent contract)
- `yield_turn` will remain in the tool registry but will no longer be the *only* way to end a turn.
- With `toolChoice: auto`, the model can stop naturally (no tool calls → done).
- `yield_turn` continues to serve subagent orchestration where structured completion signals are needed.
- The stop-drift correction in `loop.ts:709-748` will be updated to handle `toolChoice: auto` (where bare stops are normal, not drift).

### D3: No middleware or event pipeline
- Service extraction (Gemini CLI style) + pure generator pattern (Claude Code style).
- No `EngineReactor`, no middleware chain, no event bus.

### D4: All three phases ship together
- Phase 1 (toolChoice), Phase 2 (DB decoupling), Phase 3 (service extraction) are implemented in one pass.
- They are tightly coupled: changing toolChoice affects stop-drift, which is extracted as a service, which depends on DB decoupling.

---

## 4. Implementation Phases

| Phase | Document | Summary |
|-------|----------|---------|
| **Phase 1** | [01-phase1-toolchoice-yield-turn.md](./01-phase1-toolchoice-yield-turn.md) | Switch `toolChoice` default to `auto`, update stop-drift logic, keep `yield_turn` as opt-in |
| **Phase 2** | [02-phase2-db-decoupling.md](./02-phase2-db-decoupling.md) | Move all `Session.updatePart/Message` calls out of `persister.ts` hot path, make persister an in-memory accumulator, consumer handles DB |
| **Phase 3** | [03-phase3-service-extraction.md](./03-phase3-service-extraction.md) | Extract `StopDriftService`, `CompactionService`, `PlanModeService` from inline logic |

---

## 5. Verification Plan

### Automated
- `bun test test/sessions` — all existing session tests must pass
- `bun typecheck` — zero new errors
- `bun lint:fix` — clean

### Manual
- E2E: Start a session, verify model stops naturally without calling `yield_turn`
- E2E: Verify `yield_turn` still works when explicitly called by subagents
- E2E: Verify stop-drift correction fires for plan mode (model must still call `plan_exit`/`ask_user`)
- E2E: Verify DB persistence: cancel mid-stream, verify all reasoning/text parts are persisted
- E2E: Verify compaction still triggers on context overflow

### Telemetry Validation
- Monitor `finish` reasons across providers after deploying `toolChoice: auto`
- Compare premature stop rates before/after
- Verify no regression in tool call rates
