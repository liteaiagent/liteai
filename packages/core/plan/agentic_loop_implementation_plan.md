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

### Phase 2: Implementing the Pre-Processing Context Pipeline - [COMPLETED]
Before invoking the model in each turn, applying constraints aggressively.

**Target Files (NEW):**
- `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\engine\pipeline.ts`
  - *Refactor Goal*: Build a chain of functions that the original raw `Message[]` array passes through.
  - Implement:
    1. **`applyToolResultBudget`**: Hard limits on how many bytes a tool result is allowed to take.
    2. **`snipCompact`**: Checks for and trims useless/aborted historical branches.
    3. **`autocompact`**: Hook into our current `TaskTool` compaction, but trigger it proactively based on predicted inputs rather than retroactively.

**What was done:**
- Created `pipeline.ts` with no SQLite/DB imports. Everything operates cleanly on `Message.WithParts[]` memory objects.
- **Stage 1 (`applyToolResultBudget`)**: Implemented aggregate budgeting. If parallel tool outputs in a single user turn exceed 200,000 characters, it dynamically clears the largest outputs and replaces them with a `[Old tool result content cleared]` sentinel, protecting `time.compacted` state to ensure prompt cache stability across generation turns.
- **Stage 2 (`snipCompact`)**: Slices off aborted assistant `AbortedError` branches that yielded zero functional text or valid tools, freeing up token window blocks before LLM submission.
- **Stage 3 (`shouldAutocompact`)**: Completely shifted compaction from a *reactive* fail-state to a *proactive* mathematical estimate check: `Model Context Size - 20,000 Reserved - 13,000 Early Warning Buffer`. Also integrated a 3-strike Circuit Breaker to prevent infinite compaction retry loops.
- Integrated the entire pipeline synchronously into `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\engine\loop.ts` right before `Message.toModelMessages()`.
- Authored robust, edge-case unit tests in `pipeline.test.ts` achieving full pass rates across 9 distinct testing suites and successfully validating codebase typechecks (`bun typecheck`).

### Phase 3: The Async Generator `queryLoop` (The New Brain)
Replacing `loop.ts` with the new structure.

**Target Files:**
- `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\engine\loop.ts` -> rename to `query.ts` or rebuild in parallel.
  - *Refactor Goal*: Destroy the standard `while(true)` synchronous promise loop and rebuild it strictly as `export async function* queryLoop(params)`.
  - *Detailed Flow & Mechanics*:
    1. **Initialization**: Accepts `QueryParams` (raw unbudgeted messages, model, tool context configs, and abort signals).
    2. **Pre-Processing Pipeline (Phase 2)**: Runs `messages = executePipeline(messages)` immediately at the top of the iteration.
    3. **Proactive Limits**: Validates `shouldAutocompact()` and triggers the recursive or separate generator fallback if true.
    4. **LLM Delegation**: Enters the model streaming loop API, listening to the deeply decoupled `SessionProcessor` generator (from Phase 1).
    5. **Pure Event Yielding**: `yield` standard `EngineEvent.Any` events (`delta`, `block-start`, `block-end`) upwards. Crucially, *this generator must not write directly to SQLite*.
    6. **Consumer Delegation**: The actual `EventPersister` handles the SQLite writing. We will need an orchestrator (a `runSession()` wrapper) that instantiates `const loop = queryLoop()`, routes the events to the persister, and streams them simultaneously to the frontend bus.
    7. **Tombstone Semantics**: Handle graceful `StreamingFallback` mechanics (catching parsing / `AbortedError` failures mid-stream and explicitly yielding `Tombstone` cleanup events so the persister scrubs orphaned/partial parts from the database).

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
