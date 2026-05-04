# Phase 3: Service Extraction — Isolated Concerns

> **Depends on**: Phase 1 (stop-drift changes), Phase 2 (DB decoupling)
> **Risk**: Low — extracting existing logic, no behavioral changes
> **Pattern source**: Gemini CLI (`LoopDetectionService`, `ChatCompressionService`, `Scheduler` as separate classes)

---

## 1. Problem Statement

`loop.ts` (1,251 lines) and `query.ts` (598 lines) mix multiple concerns inline:

| Concern | Location | Lines |
|---------|----------|-------|
| Stop-drift recovery (plan mode) | `query.ts:120-139`, `loop.ts:665-708` | ~60 |
| Stop-drift recovery (general) | `query.ts:141-158`, `loop.ts:709-748` | ~50 (removed in Phase 1) |
| Loop detection + recovery | `query.ts:478-492`, `loop.ts:448-486`, `loop.ts:653-664` | ~70 |
| Compaction orchestration | `query.ts:220-242`, `loop.ts:527-543`, `loop.ts:597-651` | ~80 |
| Plan mode state management | `query.ts:249-262`, `query.ts:525-530`, `loop.ts:383-386` | ~30 |
| Correction message injection | `loop.ts:980-1020` | ~40 |
| Task notification injection | `loop.ts:830-890` | ~60 |
| Subtask processing | `loop.ts:580-596`, `loop.ts:1035-1250` | ~250 |

This means a change to loop detection can break compaction, a change to plan mode can break stop-drift, etc. Each concern should be a separate module with a clear interface.

---

## 2. What Gets Extracted (and What Doesn't)

### EXTRACT: Self-contained concerns with clear interfaces

1. **`StopDriftService`** — Plan mode stop-drift detection and correction
2. **`CompactionOrchestrator`** — Overflow detection, marker creation, compaction task processing
3. **`CorrectionInjector`** — Injecting synthetic user messages for corrections, notifications, etc.

### DON'T EXTRACT: Already isolated or too tightly coupled

- **`LoopDetectionService`** — Already extracted in `loop-detection.ts` ✅
- **`StreamingToolExecutor`** — Already extracted in `streaming-tool-executor.ts` ✅
- **`PlanModeStateRef`** — Already isolated in `plan-mode-state.ts` ✅
- **Subtask processing** — Too tightly coupled to session creation/model resolution to extract cleanly. Leave in `loop.ts` for now.
- **Event routing switch/case** — The routing itself is the orchestrator's job. It stays in `loop.ts`.

---

## 3. Service Specifications

### 3.1 `StopDriftService` — NEW FILE

**File**: `packages/core/src/session/engine/stop-drift.ts`

**Responsibility**: Detect when a model stops without calling required tools (only in plan mode after Phase 1) and return the appropriate corrective action.

```typescript
import type { PlanModeStateRef } from "../plan-mode-state"
import type { Message } from "../message"
import type { SessionID } from "../schema"

export interface StopDriftResult {
  /** Whether drift was detected and correction is needed */
  drifted: boolean
  /** The correction message to inject, if any */
  correctionText?: string
  /** Current correction count for logging */
  correctionCount?: number
}

export class StopDriftService {
  private planStopCorrectionCount = 0
  private readonly maxPlanStopCorrections = 3

  constructor(
    private readonly sessionID: SessionID,
    private readonly planModeStateRef: PlanModeStateRef,
  ) {}

  /**
   * Check if the model stopped when it shouldn't have.
   * Returns drift result with correction text if needed.
   *
   * After Phase 1, this ONLY checks plan mode drift.
   * General stop-drift (for toolChoice: required) is removed.
   */
  check(lastAssistant: Message.Assistant): StopDriftResult {
    const planState = this.planModeStateRef.get()

    // Only plan mode enforces mandatory tool calls
    if (!planState.active) {
      return { drifted: false }
    }

    if (this.planStopCorrectionCount >= this.maxPlanStopCorrections) {
      return { drifted: false } // Give up after max corrections
    }

    this.planStopCorrectionCount++

    return {
      drifted: true,
      correctionCount: this.planStopCorrectionCount,
      correctionText: [
        "<system-correction>",
        "STOP. You ended your turn without calling a tool.",
        "",
        "You are in PLAN MODE. Implementation is BLOCKED until you call `plan_exit` and the user approves your plan.",
        "You CANNOT start building, creating files, or implementing — approval via `plan_exit` is MANDATORY.",
        "",
        "End your turn with one of these tool calls:",
        "- `plan_exit` — if your plan is written and ready for user review",
        "- `ask_user` — if you need clarification from the user first",
        "",
        "Do NOT end your turn with just text or reasoning. Call a tool now.",
        "</system-correction>",
      ].join("\n"),
    }
  }
}
```

**Integration in `query.ts`**:

```typescript
// Replace inline plan mode drift logic (lines 120-139) with:
const driftResult = stopDriftService.check(lastAssistant)
if (driftResult.drifted) {
  log.warn("plan mode stop-drift", {
    sessionID,
    correctionCount: driftResult.correctionCount,
  })
  yield {
    type: "control",
    action: "plan-stop-correction",
    payload: {
      correctionCount: driftResult.correctionCount,
      correctionText: driftResult.correctionText,
    },
  } satisfies EngineEvent.GeneratorResultEvent
  continue
}
```

**Integration in `loop.ts`**:

The `plan-stop-correction` handler (lines 665-708) uses the correction text from the payload instead of hardcoding it:

```typescript
case "plan-stop-correction": {
  const { correctionCount, correctionText } = event.payload as {
    correctionCount: number
    correctionText: string
  }

  if (currentAssistantMessage) {
    await stripIncompleteThinking({ sessionID, message: currentAssistantMessage })
  }

  const lastUser = findLastUserFromBuffer(msgsBuffer.current)
  if (lastUser && correctionText) {
    await correctionInjector.inject({
      sessionID,
      lastUser,
      text: correctionText,
      msgsBuffer,
    })
  }

  if (currentAssistantMessage) {
    await InstructionPrompt.clear(currentAssistantMessage.id)
  }
  break
}
```

---

### 3.2 `CompactionOrchestrator` — NEW FILE

**File**: `packages/core/src/session/engine/compaction-orchestrator.ts`

**Responsibility**: Centralize overflow detection, marker creation, and compaction task processing. Currently this logic is spread across `query.ts:220-242`, `loop.ts:527-543`, `loop.ts:597-651`, and `persister.ts:237-239, 340-342`.

```typescript
import type { SessionID } from "../schema"
import type { Message } from "../message"
import type { Provider } from "../../provider/provider"
import { SessionCompaction } from "../tasks/compaction"

export class CompactionOrchestrator {
  constructor(private readonly sessionID: SessionID) {}

  /**
   * Check if the context window is overflowing.
   * Called from query.ts after each turn to decide if compaction is needed.
   */
  async isOverflow(tokens: Message.TokenInfo | undefined, model: Provider.Model): Promise<boolean> {
    if (!tokens) return false
    return SessionCompaction.isOverflow({ tokens, model })
  }

  /**
   * Create a compaction marker.
   * Called from loop.ts when overflow is detected or persister signals "compact".
   */
  async createMarker(params: {
    agent: string
    model: { providerID: string; modelID: string }
    auto: boolean
    overflow?: boolean
  }) {
    return SessionCompaction.create({
      sessionID: this.sessionID,
      ...params,
    })
  }

  /**
   * Process a compaction task (execute the actual compaction).
   * Called from loop.ts when the generator yields a compaction-task control event.
   */
  async process(params: {
    messages: Message.WithParts[]
    parentID: string
    abort: AbortSignal
    auto: boolean
    overflow?: boolean
    telemetryTracker: unknown
    telemetryBatchId: string
  }) {
    return SessionCompaction.process({
      sessionID: this.sessionID,
      ...params,
    })
  }

  /**
   * Prune old compaction artifacts.
   * Called from loop.ts after the session loop completes.
   */
  async prune() {
    return SessionCompaction.prune({ sessionID: this.sessionID })
  }
}
```

This is a thin wrapper today, but it centralizes the compaction decision-making that's currently scattered across three files. As compaction logic evolves (e.g., smart compaction timing based on token budget), it has a single home.

---

### 3.3 `CorrectionInjector` — NEW FILE

**File**: `packages/core/src/session/engine/correction-injector.ts`

**Responsibility**: Inject synthetic user messages for corrections, notifications, and loop recovery feedback. Currently duplicated across `injectCorrectionMessage()` (loop.ts:980-1020) and `injectTaskNotifications()` (loop.ts:830-890).

```typescript
import type { SessionID, MessageID } from "../schema"
import type { Message } from "../message"
import { Session } from ".."

export class CorrectionInjector {
  constructor(private readonly sessionID: SessionID) {}

  /**
   * Inject a correction message into the session.
   * Creates a synthetic user message with the correction text.
   * Updates the in-memory buffer to include the new message.
   */
  async inject(params: {
    lastUser: Message.User
    text: string
    msgsBuffer: { current: Message.WithParts[] }
  }): Promise<void> {
    // Delegates to existing injectCorrectionMessage() logic
    // ... (extracted from loop.ts:980-1020)
  }

  /**
   * Inject task completion notifications.
   * Checks the background task registry for completed tasks and injects
   * notification messages for the model to see.
   */
  async injectNotifications(params: {
    registry: unknown // BackgroundTaskRegistry
    lastUser: Message.User
    msgsBuffer: { current: Message.WithParts[] }
  }): Promise<void> {
    // Delegates to existing injectTaskNotifications() logic
    // ... (extracted from loop.ts:830-890)
  }
}
```

---

## 4. Integration Plan

### Step 1: Create service files with extracted logic
- `stop-drift.ts` — extract from `query.ts:120-139` and `loop.ts:665-748`
- `compaction-orchestrator.ts` — thin wrapper around `SessionCompaction` calls
- `correction-injector.ts` — extract from `loop.ts:830-890, 980-1020`

### Step 2: Wire services into `query.ts`
- Create `StopDriftService` in `queryLoop()` params or constructor
- Replace inline plan mode drift check with `stopDriftService.check()`

### Step 3: Wire services into `loop.ts`
- Create `CompactionOrchestrator` and `CorrectionInjector` in `runSessionInner()`
- Replace inline calls to `SessionCompaction.*` with orchestrator methods
- Replace inline `injectCorrectionMessage()` / `injectTaskNotifications()` with injector methods
- Move the extracted helper functions (currently at bottom of loop.ts) into their respective service files

### Step 4: Delete extracted code from loop.ts
- Remove `injectCorrectionMessage()` function (currently ~40 lines)
- Remove `injectTaskNotifications()` function (currently ~60 lines)
- Remove inline compaction creation logic (delegated to orchestrator)

---

## 5. What Stays in `loop.ts`

After extraction, `loop.ts` retains only its core orchestrator role:

1. **Session lifecycle** (`start`, `cancel`, `cleanup`, `loop`)
2. **Event routing** (the `for await` switch/case)
3. **Buffer management** (`msgsBuffer.current` updates)
4. **Subtask processing** (`processSubtask()` — too coupled to extract cleanly now)
5. **Post-loop cleanup** (prune, fork cache)

Estimated final size: ~600-700 lines (down from 1,251).

---

## 6. Testing Strategy

### Unit Tests for Extracted Services

**`stop-drift.test.ts`**:
- Plan mode active + model stopped → returns `{ drifted: true }` with correction text
- Plan mode inactive + model stopped → returns `{ drifted: false }`
- Plan mode active + max corrections exceeded → returns `{ drifted: false }`
- Multiple calls increment correction count

**`compaction-orchestrator.test.ts`**:
- Overflow detection with various token counts
- Marker creation with correct params
- Verify it delegates to `SessionCompaction` correctly

**`correction-injector.test.ts`**:
- Correction message creates a user message with correct text
- Buffer is updated with new message
- Notification injection handles empty registry

### Integration Tests
- Full session flow with plan mode → stop-drift service fires
- Full session with overflow → compaction orchestrator creates marker
- Loop recovery → correction injector injects feedback

---

## 7. File Inventory Summary

| File | Action | Estimated Lines |
|------|--------|----------------|
| `engine/stop-drift.ts` | **NEW** | ~80 |
| `engine/compaction-orchestrator.ts` | **NEW** | ~70 |
| `engine/correction-injector.ts` | **NEW** | ~100 |
| `engine/persistence-writer.ts` | **NEW** (Phase 2) | ~30 |
| `engine/query.ts` | **MODIFY** — use `StopDriftService`, remove inline drift logic | -30 lines |
| `engine/loop.ts` | **MODIFY** — use services, remove extracted functions | -400 lines |
| `engine/persister.ts` | **MODIFY** (Phase 2) — remove DB writes, add write queue | ~same |
| `engine/events.ts` | **MODIFY** — remove `stop-drift-correction` action | -1 line |
| `bundled/prompts/tools/yield_turn.txt` | **MODIFY** — update description | ~same |

**Net effect**: ~280 new lines in focused modules, ~430 removed from monolithic files.
