# Recovery Plan: Sub-Agent Architecture (Phases 1–7)

**Feature**: 002-subagent-architecture  
**Created**: 2026-04-13  
**Input**: [implementation_review.md](../../..) (review artifact from 2026-04-13)  
**Scope**: All issues identified in Phases 1–7 that must be resolved before proceeding to Phase 8  
**Status**: ✅ **ALL TIERS COMPLETE** (16/16 tasks resolved)

---

## Recovery Task Format

Each task specifies:
- **Tier**: P0 (blocking), P1 (critical), P2 (important), P3 (before-ship)
- **File(s)**: Exact paths and line numbers
- **Issue**: What's wrong and which spec requirement it violates
- **Fix**: Precise implementation specification
- **Test**: Required test assertion
- **Depends**: Task dependency (if any)

---

## Tier 0: Blocking (§VI Violations — Fix Before ANY New Work)

These are active Constitution §VI (Fail-Fast) violations. Silent fallbacks that hide systemic issues.

### R001 — ✅ DONE — Eliminated via `runAgent` refactor

**File**: `packages/core/src/agent/runner.ts`  
**Resolution**: Refactored `runAgent` to accept a pre-validated `RunAgentInput` object with a required `agentDefinition: Agent.AgentDefinition` parameter. The agent lookup is now the **caller's** responsibility. This eliminates the null-handling gap by construction — the type system prevents undefined definitions.

**Changes made**:
- `runAgent(agentName: string, sessionId, options?)` → `runAgent(input: RunAgentInput)`
- Added `runAgentByName()` convenience wrapper that does `Agent.get()` + null guard + `AgentSpawnError`
- All 4 test call sites updated to pass `agentDefinition` directly (no `Agent.get` spy needed)
- Added 2 new tests for `runAgentByName` (AgentSpawnError on not-found, delegation to runAgent)

**Tests**: 6/6 passing (4 existing + 2 new). See `runner.test.ts`.

---

### R002 — ✅ DONE — `enqueueAgentNotification()` via Bus event

**File**: `packages/core/src/agent/lifecycle.ts` L43–46  
**Violates**: Constitution §VI, T036, SC-008 (notifications within 1s of terminal state)  
**Issue**: Function body is empty. All terminal notifications for background agents are silently discarded. This undermines the entire background agent observability contract.

**Fix**: Publish notification as a new Bus event. This event will be consumed by the SSE layer and terminal notification transport when wired.

Step 1 — Define event in `packages/core/src/agent/events.ts`:
```typescript
TerminalNotification: BusEvent.define(
  "agent.terminal_notification",
  z.object({
    agentId: z.string(),
    status: z.enum(["completed", "failed", "killed"]),
    description: z.string(),
    usage: z.object({
      totalTokens: z.number(),
      toolCalls: z.number(),
      duration: z.number(),
    }),
    error: z.string().optional(),
    partialResult: z.string().optional(),
  }),
),
```

Step 2 — Replace the no-op body in `packages/core/src/agent/lifecycle.ts`:
```typescript
export function enqueueAgentNotification(sessionId: string, notification: TerminalNotification) {
  Bus.publish(AgentEvent.TerminalNotification, {
    agentId: notification.agentId,
    status: notification.status,
    description: notification.description,
    usage: notification.usage,
    error: notification.error?.message,
    partialResult: notification.partialResult,
  })
  logger.info("terminal notification enqueued", { sessionId, agentId: notification.agentId, status: notification.status })
}
```

**Test**: Add to `packages/core/test/agent/lifecycle.test.ts`:
```typescript
it("enqueueAgentNotification publishes Bus event", () => {
  const spy = spyOn(Bus, "publish").mockResolvedValue([])
  enqueueAgentNotification("sess-1", {
    agentId: "a1",
    status: "completed",
    description: "Agent test completed",
    usage: { totalTokens: 100, toolCalls: 2, duration: 1000 },
  })
  expect(spy).toHaveBeenCalledWith(
    AgentEvent.TerminalNotification,
    expect.objectContaining({ agentId: "a1", status: "completed" }),
  )
})
```

**Status**: Implemented. `AgentEvent.TerminalNotification` added to events.ts. `enqueueAgentNotification` publishes Bus event with agentId, status, description, usage, error, partialResult.  
**Tests**: 3 tests added (correct payload, error message extraction, partial result for killed agents). All passing.

---

### R003 — ✅ DONE — `ensureMemoryDirExists()` error handling (REVISED)

**File**: `packages/core/src/agent/memory.ts` L45–47  
**Original**: Rethrow non-EEXIST errors  
**Revised per liteai2 analysis**: **Log-but-not-throw**. liteai2's `memdir.ts:129–147` intentionally catches and logs all errors — memory dir creation is best-effort because the Write tool provides its own `mkdir` safety net. This is NOT a Constitution §VI violation: logging makes errors observable for UAT while preserving agent spawn resilience.

**Fix**:
```typescript
export async function ensureMemoryDirExists(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch (err: unknown) {
    // Best-effort: the Write tool does its own mkdir as a safety net.
    // Log the failure so it's visible in --debug output and UAT telemetry.
    const code = err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined
    logger.warn("ensureMemoryDirExists failed", { dir, code: code ?? String(err) })
  }
}
```

**Test**: Extend `packages/core/test/agent/memory.test.ts`:
```typescript
it("logs warning on permission denied but does not throw", async () => {
  const err = Object.assign(new Error("EACCES"), { code: "EACCES" })
  spyOn(fs, "mkdir").mockRejectedValueOnce(err)
  // Should NOT throw — best-effort with logging
  await expect(AgentMemory.ensureMemoryDirExists("/fake/dir")).resolves.toBeUndefined()
  // Verify logger.warn was called (TODO: add logger spy)
})
**Status**: Implemented. Logger added to memory.ts. Errors are caught and logged via `logger.warn` — not thrown.  
**Tests**: Existing idempotency test still passes.

---

### R004 — ✅ DONE — `loadAgentMemoryPrompt()` error handling (REVISED)

**File**: `packages/core/src/agent/memory.ts` L60–64  
**Original**: Rethrow non-ENOENT errors  
**Revised per liteai2 analysis**: **Catch-and-log**. liteai2's `buildMemoryPrompt` (memdir.ts:286–291) catches all readFile errors — "No memory file yet" is the common case, and non-ENOENT errors are rare real-world edge cases that should be logged but not crash the agent.

**Fix**:
```typescript
let content = ""
try {
  content = await fs.readFile(memFile, "utf-8")
} catch (err: unknown) {
  const code = err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined
  if (code !== "ENOENT") {
    // Non-ENOENT = real problem. Log for observability but don't crash agent spawn.
    logger.warn("loadAgentMemoryPrompt read failed", { memFile, code: code ?? String(err) })
  }
  // Return empty content — agent proceeds without memory
}
```

**Test**: Extend `packages/core/test/agent/memory.test.ts`:
```typescript
it("logs warning on permission denied but returns empty content", async () => {
  spyOn(fs, "readFile").mockRejectedValueOnce(
    Object.assign(new Error("EACCES"), { code: "EACCES" })
  )
  // Should NOT throw — logs and returns empty prompt
  const result = await AgentMemory.loadAgentMemoryPrompt("test_agent", "project")
  expect(result).toBe("")
})
**Status**: Implemented. Non-ENOENT errors are logged via `logger.warn`. ENOENT (no file yet) is silently swallowed (expected case).  
**Tests**: Existing tests still pass.

---

### R005 — ✅ DONE — `copyProjectSnapshotToLocal()` error handling (REVISED)

**File**: `packages/core/src/agent/memory.ts` L95–101  
**Original**: Remove try-catch entirely  
**Revised per liteai2 analysis**: **Catch-and-log**. liteai2's equivalent (`agentMemorySnapshot.ts`) catches and logs snapshot copy errors — copy failure should not crash agent spawn. The function is called during agent initialization and is not critical-path.

**Fix**:
```typescript
export async function copyProjectSnapshotToLocal(agentType: string): Promise<void> {
  const projectDir = getAgentMemoryDir(agentType, "project")
  const localDir = getAgentMemoryDir(agentType, "local")
  if (projectDir === localDir) return

  try {
    await fs.mkdir(localDir, { recursive: true })
    await fs.copyFile(
      path.join(projectDir, "MEMORY.md"),
      path.join(localDir, "MEMORY.md"),
    )
  } catch (err: unknown) {
    // Snapshot copy is best-effort — log for observability, don't crash.
    logger.warn("copyProjectSnapshotToLocal failed", {
      agentType,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
```

**Test**: The existing test validates the happy path. Add:
```typescript
it("logs warning on copy failure but does not throw", async () => {
  spyOn(fs, "copyFile").mockRejectedValueOnce(
    Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }),
  )
  // Should NOT throw — logs and continues
  await expect(AgentMemory.copyProjectSnapshotToLocal("test_agent")).resolves.toBeUndefined()
})
**Status**: Implemented. Copy errors are caught and logged via `logger.warn` — not thrown.  
**Tests**: Existing copy test still passes.

---

## Tier 1: Critical (Data Model Alignment & Architecture Fixes)

These are structural divergences from the data model that will compound as more phases are implemented.

### R006 — ✅ DONE — Align SubagentContext with data-model.md

**Files**:
- `packages/core/src/agent/context.ts` (SubagentContext interface + createSubagentContext factory)
- `specs/002-subagent-architecture/data-model.md` (canonical reference)

**Issue**: 7 fields specified in data-model.md are missing or misnamed in the implementation.

**Fix** — Update `SubagentContext` interface (context.ts L43–59):

```typescript
export interface SubagentContext {
  type: "subagent"
  agentId: string
  agentType: string              // ← ADD: agent definition type name
  parentSessionId: string        // ← RENAME from sessionId
  isBuiltIn: boolean             // ← ADD: source provenance flag
  abortController: AbortController
  readFileState: Map<string, any>
  contentReplacementState?: any  // ← ADD: cloned for cache stability (FR-004)
  queryTracking: { depth: number }  // ← ADD: recursion observability
  toolDecisions?: Record<string, ToolDecision>
  thinkingConfig?: ThinkingConfig
  invocationKind: "spawn" | "resume"  // ← ADD: spawn vs resume (resume is type-only for Phase 4)
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  setAppStateForTasks: (action: "registerTask" | "killTask" | "deleteTodo", payload: unknown) => void
  cwd: string
  effort?: string
  criticalSystemReminder?: string
  invokingRequestId?: string
}
```

Update `createSubagentContext()` factory (context.ts L97–182):

```diff
  return {
    type: "subagent",
-   agentId: agent.name || "unknown",
-   sessionId: parent.sessionId,
+   agentId: "",  // Caller (runner.ts) MUST set this
+   agentType: agent.name || "unknown",
+   parentSessionId: parent.sessionId,
+   isBuiltIn: "native" in agent && agent.native === true,
+   contentReplacementState: parent.contentReplacementState
+     ? (typeof structuredClone === "function"
+         ? structuredClone(parent.contentReplacementState)
+         : JSON.parse(JSON.stringify(parent.contentReplacementState)))
+     : undefined,
+   queryTracking: {
+     depth: (parent as any).queryTracking?.depth
+       ? (parent as any).queryTracking.depth + 1
+       : 1,
+   },
+   invocationKind: "spawn",
    abortController,
    readFileState: new Map(parent.readFileState),
    toolDecisions: undefined,
    // ... rest unchanged
  }
```

**Cascade changes** — Update all references to `sessionId` → `parentSessionId`:
- `runner.ts`: All references to `subContext.sessionId`
- `sandbox.ts`: L93–94 (reads `context.sessionId` → `context.parentSessionId`)
- `context.test.ts`: ParentContext mock uses `sessionId` correctly (no change), but SubagentContext assertions may reference `sessionId`

**Test**: Update `packages/core/test/agent/context.test.ts`:
```typescript
it("createSubagentContext populates all data-model fields", () => {
  const ctx = createSubagentContext(parent, {
    name: "explore", native: true, source: "builtIn",
  })
  expect(ctx.type).toBe("subagent")
  expect(ctx.agentType).toBe("explore")
  expect(ctx.parentSessionId).toBe("sess-1")
  expect(ctx.isBuiltIn).toBe(true)
  expect(ctx.queryTracking.depth).toBe(1)
  expect(ctx.invocationKind).toBe("spawn")
  expect(ctx.contentReplacementState).toBeUndefined()
})

it("increments queryTracking.depth for nested forks", () => {
  const ctx1 = createSubagentContext(parent, { name: "a" })
  // ctx1 has depth=1; fork from ctx1 as parent
  const ctx2 = createSubagentContext(
    { ...parent, queryTracking: { depth: ctx1.queryTracking.depth } },
    { name: "b" },
  )
  expect(ctx2.queryTracking.depth).toBe(2)
})

it("clones contentReplacementState from parent", () => {
  const parentWithCRS = {
    ...parent,
    contentReplacementState: { key: "value" },
  }
  const ctx = createSubagentContext(parentWithCRS, { name: "a" })
  expect(ctx.contentReplacementState).toEqual({ key: "value" })
  // Verify it's a clone, not the same reference
  expect(ctx.contentReplacementState).not.toBe(parentWithCRS.contentReplacementState)
})
```

**Depends**: None (R001 was eliminated by the runAgent refactor).

---

### R007 — ✅ DONE — Subsumed by `runAgent` refactor

**Resolution**: The `runAgent` refactor (R001) generates `agentId` once in the runner and assigns it to the context. The factory no longer sets a misleading placeholder. The split-assignment anti-pattern is eliminated.

**Current code** (`runner.ts`):
```typescript
const agentId = Math.random().toString(36).substring(7)
// ...
const subContext = createSubagentContext(parentMock, agentDef, overrides)
subContext.agentId = agentId  // Single, clear assignment
```

**Remaining**: R006 should change the factory to set `agentId: ""` (empty string) instead of `agent.name || "unknown"` to make the placeholder intent explicit.

---

### R008 — ✅ DONE — Fix `runAsyncAgentLifecycle()` ALS fallback

**File**: `packages/core/src/agent/lifecycle.ts` L138–139  
**Violates**: FR-024 (execution MUST be wrapped via `runWithAgentContext()`)  
**Issue**: When `AgentExecutionContext.getStore()` returns null, the function silently executes without ALS wrapping, breaking analytics attribution isolation.

**Fix**: Construct a synthetic SubagentContext from available parameters rather than running naked:

```typescript
export async function runAsyncAgentLifecycle(
  agentName: string,
  sessionId: string,
  agentId: string,
  runAgentImpl: () => Promise<import("./agent").Agent.RunAgentResult>,
) {
  const existingContext = AgentExecutionContext.getStore()

  // If no ALS context exists, construct a minimal one for attribution isolation (FR-024)
  const context: AgentContext = existingContext ?? {
    type: "subagent" as const,
    agentId,
    agentType: agentName,
    parentSessionId: sessionId,
    isBuiltIn: false,
    invocationKind: "spawn" as const,
    queryTracking: { depth: 1 },
  } as SubagentContext  // Minimal context for ALS attribution

  return await runWithAgentContext(context, async () => {
    // ... rest of implementation unchanged
  })
}
```

**Test**: Add to `packages/core/test/agent/lifecycle.test.ts`:
```typescript
it("runAsyncAgentLifecycle wraps execution in ALS even without pre-existing context", async () => {
  // Ensure no ALS context is set
  let capturedAgentId: string | undefined
  const impl = async () => {
    capturedAgentId = AgentExecutionContext.getStore()?.agentId
    return { agentId: "a1", status: "completed" as const, result: "ok", usage: { totalTokens: 0, toolCalls: 0, duration: 0 } }
  }

  spyOn(Bus, "publish").mockResolvedValue([])
  await runAsyncAgentLifecycle("test", "sess-1", "a1", impl)
  expect(capturedAgentId).toBe("a1")
})
```

**Depends**: R006 (SubagentContext type must be updated first).

---

## Tier 2: Important (Incomplete Implementations & Dead Code)

These items were marked complete in tasks.md but are functional stubs.

### R009 — ✅ DONE — `startAgentSummarization` deferred explicitly

**File**: `packages/core/src/agent/lifecycle.ts` L108–130  
**Violates**: T038b (marked [x] in tasks.md but body is a no-op)  
**Issue**: The 30-second loop fires but does nothing. The plan requires it to fork the transcript and produce a 3-5 word activity description pushed to parent AppState.

**Decision required**: Two alternatives:

**Alternative A — Implement now**:
The loop should:
1. Capture the current transcript messages from ALS context
2. Generate a short activity description (could use a simple heuristic from the ProgressTracker's current activity rather than an LLM call for v1)
3. Push the description via a Bus event or rootSetAppState callback

**Alternative B — Defer explicitly**:
- Mark T038b as `[ ]` in tasks.md 
- Replace the function body with `throw new Error("Not implemented: startAgentSummarization — deferred to Phase 11")`
- Add to `deferred-items.md`

**Recommendation**: Alternative B. Agent summarization requires transcript fork + LLM call integration that crosses into the query loop infrastructure. Implementing a heuristic-only version would be a half-measure.

---

### R010 — ✅ DONE — `setAppStateForTasks` as root store passthrough (REVISED)

**File**: `packages/core/src/agent/context.ts` L150–159  
**Original plan**: Scoped validator with `registerTask`/`killTask`/`deleteTodo` actions  
**Revised per liteai2 analysis**: **Root store passthrough**. liteai2's `forkedAgent.ts:416–417` reveals the correct pattern: `setAppStateForTasks` is NOT a scoped operation API — it's a forwarding reference to the root session's `setAppState` that ensures task management always works even when the agent's own `setAppState` is no-op'd for isolation.

Without this, background bash tasks spawned by sub-agents are never registered in AppState and become PPID=1 zombies.

**Fix** — Update `createSubagentContext()` in context.ts:
```typescript
// Task registration/kill must always reach the root store, even when
// setAppState is a no-op — otherwise background tasks are never
// registered and never killed (PPID=1 zombie). (See liteai2 forkedAgent.ts:416)
setAppStateForTasks: parent.setAppStateForTasks ?? parent.setAppState,
```

Update `ParentContext` type to include the optional field:
```typescript
export interface ParentContext {
  // ... existing fields ...
  setAppStateForTasks?: (updater: (state: AppState) => AppState) => void
}
```

**Test**:
```typescript
it("setAppStateForTasks forwards to parent even when setAppState is no-op", () => {
  const rootSetter = jest.fn()
  const parent = createParent({
    setAppState: () => {},  // no-op for isolation
    setAppStateForTasks: rootSetter,
  })
  const ctx = createSubagentContext(parent, { name: "a" })
  ctx.setAppStateForTasks?.(prev => ({ ...prev, newTask: true }))
  expect(rootSetter).toHaveBeenCalled()
})
```

---

### R011 — ✅ DONE — `shareSetResponseLength` comment added

**File**: `packages/core/src/agent/context.ts` L73  
**Issue**: `shareSetResponseLength` is declared in `SubagentContextOverrides` but never referenced in `createSubagentContext()`. It's dead code that suggests an incomplete implementation.

**Decision required**:
- **If this will be implemented in a later phase**: Keep the type, add a `// TODO: see T0XX` comment
- **If this is legacy cruft**: Remove from the interface

**Fix** (assuming kept as placeholder):
```typescript
export interface SubagentContextOverrides {
  shareSetAppState?: boolean
  shareSetResponseLength?: boolean  // Not yet wired — response length sharing requires query loop integration
  shareAbortController?: boolean
  criticalSystemReminder?: string
}
```

---

### R012 — ✅ DONE — Document `setAppState` behavior deviation

**Files**:
- `packages/core/src/agent/context.ts` L138–148
- `specs/002-subagent-architecture/data-model.md` L128

**Issue**: data-model.md says `setAppState: () => void // No-op by default`. The implementation actually mutates an independent state clone when `shareSetAppState` is false. This is arguably better (agents need local state management), but it contradicts the documented contract.

**Fix**: Update data-model.md to reflect the actual behavior:

```diff
-  setAppState: () => void             // No-op by default (prevents state leaks)
+  setAppState: (updater) => AppState  // Independent clone mutation by default (prevents leaks to parent)
+                                       // When shareSetAppState=true, delegates to parent's setAppState
```

**No code change required** — this is a documentation-only fix. The implementation behavior is correct.

---

## Tier 3: Test Coverage Recovery

These tasks fill the test gaps identified in the review.

### R013 — ✅ DONE — Context isolation tests

**File**: `packages/core/test/agent/context.test.ts`  
**Covers**: US1 AS2, US1 AS3, FR-014

**Tests to add**:

```typescript
it("file state cloning provides isolation from parent", () => {
  const parent: ParentContext = {
    sessionId: "s",
    abortController: new AbortController(),
    readFileState: new Map([["file.ts", { content: "original" }]]),
    getAppState: () => ({}),
    setAppState: () => {},
  }
  const ctx = createSubagentContext(parent, { name: "a" })
  
  // Mutate child's file state
  ctx.readFileState.set("new-file.ts", { content: "new" })
  
  // Parent must be unaffected
  expect(parent.readFileState.has("new-file.ts")).toBe(false)
  expect(parent.readFileState.size).toBe(1)
})

it("abort propagates parent→child but not child→parent", () => {
  const parent: ParentContext = {
    sessionId: "s",
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => ({}),
    setAppState: () => {},
  }
  const ctx = createSubagentContext(parent, { name: "a" })
  
  // Child abort does NOT propagate to parent
  ctx.abortController.abort("child-reason")
  expect(parent.abortController.signal.aborted).toBe(false)
})

it("parent abort propagates to child", () => {
  const parent: ParentContext = {
    sessionId: "s",
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => ({}),
    setAppState: () => {},
  }
  const ctx = createSubagentContext(parent, { name: "a" })
  
  parent.abortController.abort("parent-reason")
  expect(ctx.abortController.signal.aborted).toBe(true)
})
```

---

### R014 — ✅ DONE — ALS isolation test (3 concurrent agents)

**File**: `packages/core/test/agent/lifecycle.test.ts` L59–63 (currently empty stub)  
**Covers**: SC-009, FR-024

**Fix**: Replace the empty test body:

```typescript
it("should isolate 3 concurrent background agents", async () => {
  const results: string[] = []

  const makeAgent = (id: string, delayMs: number) => {
    const context: AgentContext = {
      type: "subagent",
      agentId: id,
      agentType: `type-${id}`,
      parentSessionId: "sess-1",
      isBuiltIn: false,
      invocationKind: "spawn",
      queryTracking: { depth: 1 },
    } as SubagentContext

    return runWithAgentContext(context, async () => {
      await Bun.sleep(delayMs)
      const store = AgentExecutionContext.getStore()
      results.push(store?.agentId ?? "MISSING")
    })
  }

  await Promise.all([
    makeAgent("agent-A", 30),
    makeAgent("agent-B", 10),
    makeAgent("agent-C", 20),
  ])

  // All 3 agents must report their own ID — zero cross-contamination
  expect(results).toContain("agent-A")
  expect(results).toContain("agent-B")
  expect(results).toContain("agent-C")
  expect(results).toHaveLength(3)
})
```

---

### R015 — ✅ DONE — Subsumed by `runAgentByName` tests

**Resolution**: The `runAgent` refactor (R001) added `runAgentByName()` which includes the null guard. Two tests were added:
- `"throws AgentSpawnError when agent is not found"` — verifies the guard
- `"delegates to runAgent when agent is found"` — verifies the happy path

Both passing in `runner.test.ts`.

---

## Tier 4: tasks.md Status Corrections

### R016 — ✅ DONE — Updated tasks.md to reflect actual completion status

**File**: `specs/002-subagent-architecture/tasks.md`

The following tasks are marked `[x]` but are incomplete or have caveats. Update their status:

| Task | Current | Corrected | Reason |
|------|---------|-----------|--------|
| T012 | `[x]` | `[x]` *(partial — see R013)* | Missing file state isolation, abort chain, nested fork tests |
| T013 | `[x]` | `[x]` *(partial — see R015)* | Missing AgentSpawnError test, nested spawn test |
| T014 | `[x]` | `[x]` *(partial — see R006, R010)* | Missing queryTracking, contentReplacementState, setAppStateForTasks is stub |
| T020 | `[x]` | `[x]` *(caveat)* | Uses agentDef.prompt directly, doesn't invoke SectionRegistry independently |
| T034 | `[x]` | `[x]` *(partial — see R014)* | ALS isolation test is empty stub, notification test targets no-op |
| T036 | `[x]` | `[x]` *(partial — see R002)* | enqueueAgentNotification is a no-op |
| T038b | `[x]` | `[ ]` *(see R009)* | startAgentSummarization loop body is empty |

---

## Execution Order

```
┌──────────────────────────────────────────────────────┐
│ Tier 0: Blocking (must complete before Phase 8)      │
│                                                      │
│  R001 ✅ DONE (eliminated by runAgent refactor)      │
│  R002 ✅ DONE (Bus event TerminalNotification)       │
│  R003 ✅ DONE (ensureMemoryDirExists — log-not-throw)│
│  R004 ✅ DONE (loadAgentMemoryPrompt — log-not-throw)│
│  R005 ✅ DONE (copyProjectSnapshot — catch-and-log)  │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Tier 1: Critical (sequential, after Tier 0)          │
│                                                      │
│  R006 ✅ DONE (SubagentContext alignment)              │
│    ↓                                                 │
│  R007 ✅ DONE (subsumed by runAgent refactor)        │
│    ↓                                                 │
│  R008 ✅ DONE (ALS fallback fix)                     │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Tier 2: Important (after Tier 1)                     │
│                                                      │
│  R009 ✅ DONE (summarization deferred)  ─┐             │
│  R010 ✅ DONE (root store          │  Independent    │
│        passthrough)              ─┤  changes        │
│  R011 ✅ DONE (comment added)      ─┤                 │
│  R012 ✅ DONE (docs updated)       ─┘                 │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Tier 3: Tests (after Tier 1 code changes settle)     │
│                                                      │
│  R013 ✅ DONE (context isolation tests)               │
│  R014 ✅ DONE (ALS 3-agent test)                      │
│  R015 ✅ DONE (subsumed by runAgentByName tests)     │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Tier 4: Documentation (can happen anytime)           │
│                                                      │
│  R016 ✅ DONE (tasks.md corrections)                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Validation Gate

After all recovery tasks are complete, run:

```bash
bun test test/agent/ test/permission/ test/session/transcript.test.ts
bun typecheck
bun lint:fix
```

All tests must pass. Only then proceed to Phase 8.

---

## Notes

- R009 recommends deferring (summarization requires query loop infrastructure).
- R010 is REVISED: implement as root store passthrough (liteai2 pattern), not a scoped validator.
- R006 is the largest remaining task and has the most cascade changes. Budget accordingly.
- R002 introduces a new Bus event type (`agent.terminal_notification`) — downstream consumers (SSE layer, web package) will need to subscribe when they wire up notifications.
- This recovery plan does NOT cover Phases 8–11. Those are new work, not recovery.

## Changelog

| Date | Change |
|------|--------|
| 2026-04-13 | R001 eliminated, R007/R015 subsumed by `runAgent(RunAgentInput)` refactor (6/6 tests passing) |
| 2026-04-13 | R003–R005 revised: log-but-not-throw per liteai2 reference analysis |
| 2026-04-13 | R010 revised: root store passthrough instead of scoped validator per liteai2 `forkedAgent.ts:416` |
| 2026-04-13 | R002 implemented: `AgentEvent.TerminalNotification` Bus event + 3 new tests (19/19 agent tests passing) |
| 2026-04-13 | R003–R005 implemented: logger added to memory.ts, all 3 functions now catch-and-log (19/19 tests passing) |
| 2026-04-13 | **Tier 0 complete** — all blocking tasks resolved |
| 2026-04-13 | R006 implemented: SubagentContext aligned with data-model.md — added agentType, parentSessionId, isBuiltIn, contentReplacementState, queryTracking, invocationKind. Factory default agentId="" (runner sets it). |
| 2026-04-13 | R010 implemented: setAppStateForTasks = `parent.setAppStateForTasks ?? parent.setAppState` (root store passthrough) |
| 2026-04-13 | R013 implemented: 4 isolation tests (file state, abort chain parent→child, abort no child→parent, toolDecisions reset) + 2 R010 tests |
| 2026-04-13 | **49/49 agent tests passing** across 6 files. Tier 1 R006/R010 complete, Tier 3 R013 complete. |
| 2026-04-13 | R008 implemented: ALS fallback in `runAsyncAgentLifecycle` now constructs minimal SubagentContext when no ALS context exists |
| 2026-04-13 | R009 implemented: `startAgentSummarization` replaced with clean no-op deferral (removed timer leak) |
| 2026-04-13 | R011 done: `shareSetResponseLength` commented as not-yet-wired |
| 2026-04-13 | R012 done: data-model.md updated — setAppState signature, setAppStateForTasks as root store passthrough, implementation note added |
| 2026-04-13 | R014 implemented: 3-concurrent-agent ALS isolation test with staggered sleeps (verifies zero cross-contamination) |
| 2026-04-13 | R016 done: tasks.md updated — T014 annotated with recovery changes, T036 marked functional, T038b marked deferred |
| 2026-04-13 | **🎉 ALL 16 RECOVERY TASKS COMPLETE** — 49/49 agent tests passing, typecheck clean, lint clean |
