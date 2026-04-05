# Implementation Plan: Agentic Loop Refactoring

This plan details the massive architectural shift necessary to migrate the **LiteAI** agentic loop (`loop.ts` & `processor.ts`) to the event-sourced async-generator paradigm found in **LiteAI2** (`query.ts`).

---

## 1. Goal & Architecture Shift

Currently, the `liteai` loop is tightly coupled to SQLite I/O. The `processor.ts` reacts to stream deltas and performs immediate blocking DB updates inline (e.g. `Session.updatePartDelta`), and the outer `loop.ts` controls sequential turns.

**The Target Architecture:**
1. **Async Generator Orchestration**: Replace the promise-based `while(true)` loop with an `async function* queryLoop(params)` that yields pure `StreamEvent`, `Message`, and `Tombstone` blocks.
2. **Pre-Stream Context Pipeline**: Aggressively format, budget, and compact the local history *before* the API call using consecutive mapping functions (Budget -> Snip -> Microcompact -> Collapse -> Autocompact).
3. **Decoupled State Sync**: The UI and Server consumers will loop over `for await (const event of queryLoop)`, executing their own SQLite I/O updates from the sequence of standard yielded events, fully separating the agent rules from the database writes.
4. **Streaming Tool Execution**: Fire tools as their arguments stream in, rather than waiting for discrete block completitions.

---

## 2. Reference Source Files (LiteAI2 - READ ONLY)
These files represent the master architecture we are porting from:

- **Core Loop**: `C:\Users\aghassan\Documents\workspace\liteai2\src\query.ts`
- **Streaming Tool Executor**: `C:\Users\aghassan\Documents\workspace\liteai2\src\services\tools\StreamingToolExecutor.ts`
- **Budget Enforcer**: `C:\Users\aghassan\Documents\workspace\liteai2\src\utils\toolResultStorage.ts`
- **Compaction Services**: 
  - `C:\Users\aghassan\Documents\workspace\liteai2\src\services\compact\snipCompact.ts`
  - `C:\Users\aghassan\Documents\workspace\liteai2\src\services\compact\autoCompact.ts`

---

## 3. Execution Phases (LiteAI Core)

### Phase 1: Decoupling the Stream Processor (Pure Event Source) - [COMPLETED]
We must first detach SQLite logic from `processor.ts` so it acts as an agnostic yield mechanism.

**Target Files:**
- `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\processor.ts`
  - *Refactor Goal*: Remove all `Session.updatePart` and `Session.updateMessage` calls.
  - *Mechanism*: Convert the default export to an `async function*` that reads the stream chunks and yields cleanly modeled `DeltaEvent` or `BlockEvent` types.

- `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\index.ts` (or consumer layer)
  - *Refactor Goal*: Introduce an `EventPersister` that listens to the `processor.ts` async generator and executes the SQLite updates synchronously to mimic the old behavior for backwards compatibility during the migration.

**What was done:**
- Created `events.ts` emitting purely modeled `EngineEvent.Any` (`DeltaEvent` and `BlockEvent`).
- Built `streamGenerator` in `processor.ts` that acts purely as an `async function*` processing stream parts.
- Implemented `EventPersister` inside `session/engine/persister.ts` that safely envelopes all previous SQLite behaviors, acting as a backward-compatibility layer so things like `loop.ts` didn't break.
- Confirmed `processor.ts` cleanly decoupled via Zero SQLite imports and checked strict types using `tsc -b`.

### Phase 2: Implementing the Pre-Processing Context Pipeline
Before invoking the model in each turn, applying constraints aggressively.

**Target Files (NEW):**
- `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\engine\pipeline.ts`
  - *Refactor Goal*: Build a chain of functions that the original raw `Message[]` array passes through.
  - Implement:
    1. **`applyToolResultBudget`**: Hard limits on how many bytes a tool result is allowed to take.
    2. **`snipCompact`**: Checks for and trims useless/aborted historical branches.
    3. **`autocompact`**: Hook into our current `TaskTool` compaction, but trigger it proactively based on predicted inputs rather than retroactively.

### Phase 3: The Async Generator `queryLoop` (The New Brain)
Replacing `loop.ts` with the new structure.

**Target Files:**
- `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\engine\loop.ts` -> rename to `query.ts` or rebuild in parallel.
  - *Refactor Goal*: Build `async function* queryLoop` based on LiteAI2.
  - *Flow*:
    1. Accepts `QueryParams` (messages, tool context, tracking vars).
    2. Runs `messages = executePipeline(messages)`.
    3. Handles token blocking limits check.
    4. Enters the model streaming loop API, listening to the decoupled `processor` generator.
    5. Exposes the graceful `StreamingFallback` mechanics (Tombstoning orphaned UI blocks).

### Phase 4: Streaming Tool Execution Integrations
Implement the streaming capability to parse JSON tool arguments actively.

**Target Files:**
- `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\engine\tools.ts`
  - *Refactor Goal*: Port over the `StreamingToolExecutor` class. Hook it into the new `queryLoop` so that as `tool-input-delta` events stream, the executor parses and natively evaluates whether the tool can trigger early execution.

---

## 4. Verification Checkpoints
To safely conclude this plan has worked effectively:

1. **State Independence Constraint**: Verify `processor.ts` has strictly 0 imports referencing SQLite/`Session` layers. It must operate purely on parsing LLM responses into typed events.
2. **Context Window Stability Constraint**: When invoking an Agent on a deep chat, the new pipeline must prove it effectively pruned noise (via Tool Budget and Snip) *before* making the LLM request, visibly observable in the trace telemetry (from the Telemetry plan).
3. **Graceful Fault Tolerance Constraint**: Intentionally throw a string-parsing error mid-stream in the LLM response. Validate that the new generator properly yields `Tombstone` events and that the `EventPersister` cleans up the SQLite DB properly without hard crashing the runtime.
