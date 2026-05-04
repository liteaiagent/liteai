# Review: Subagent Result Flow — Roadmap × Tasks × Implementation

**Scope**: Cross-artifact consistency review of `04-subagent-result-flow.md` (roadmap), `specs/010-subagent-result-flow/` (full spec suite), and the current implementation in `loop.ts` + `task.ts`.

**References**: `D:\langgraphjs` (Pregel loop, subgraph utilities), `D:\claude-code` (runAgent async generator pattern).

---

## 1. Implementation Status: ✅ Complete

All tasks (T001–T010) are marked `[x]`. Cross-checking the code confirms every stated goal has been achieved:

| Requirement | Status | Evidence |
|---|---|---|
| **FR-001**: Direct return via call stack | ✅ | `runSubagent()` at [loop.ts:154–184](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L154-L184) returns `SessionResult` directly |
| **FR-002**: No DB reads for inter-loop data | ✅ | Zero `Message.get` / `Message.stream` hits in `task.ts`, `query.ts`, `streaming-tool-executor.ts` |
| **FR-003**: Child history still persisted | ✅ | `runSubagent` creates its own `SqliteCheckpointer` at [loop.ts:182](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L182) |
| **FR-004**: Session lifecycle unchanged | ✅ | `start()`/`cleanup()` flow preserved in `runSubagent` |
| **FR-005**: Error propagation direct | ✅ | `task.ts` handles `error` and `aborted` states explicitly at [task.ts:123–155](file:///d:/liteai/packages/core/src/tool/task.ts#L123-L155) |
| **SC-001**: 0 DB reads by parent | ✅ | `ctx.messages.findLast()` replaces `Message.get()` at [task.ts:51](file:///d:/liteai/packages/core/src/tool/task.ts#L51) |

---

## 2. Roadmap ↔ Tasks ↔ Code Consistency

### 2.1 Files to Change (Roadmap vs Actual)

| Roadmap Claim | Actual |
|---|---|
| `loop.ts` — subagent delegation uses `SessionResult` | ✅ `runSubagent` exported and used |
| `query.ts` — subtask handling receives child result via return | ⚠️ No change needed — `query.ts` was already decoupled pre-Phase-4 |
| `streaming-tool-executor.ts` — stop reading child results from DB | ⚠️ No change needed — already clean |

> [!NOTE]
> The roadmap predicted 3 file modifications. In practice, only `loop.ts` and `task.ts` needed changes. `query.ts` and `streaming-tool-executor.ts` were already free of subagent DB reads after Phase 2. This is correctly reflected in the tasks (T005 is a verification task, not a code change), but the roadmap's "Files to Change" table is now stale.

### 2.2 Roadmap Analysis Tasks

The roadmap lists 4 analysis tasks at the bottom. Their status:

| Analysis Task | Resolved? |
|---|---|
| Map the exact subagent delegation path | ✅ Fully documented in `explanation.md` |
| Parent needs full message list or just final response? | ✅ Decision: final response only (spec assumption #2) |
| Fork/branch scenarios for child sessions | ✅ **Resolved** — child sessions should NOT be forked. See roadmap update. |
| Audit `TaskTool` retrieval | ✅ Fully refactored |

> [!NOTE]
> **Fork/branch analysis resolved.** Claude Code's fork model confirms: fork is context-sharing (copying the parent's message buffer), not state-cloning. Completed subagent results are already embedded in the parent's `msgsBuffer`. Forking the buffer automatically includes them. If a fork child needs to continue a prior subagent, it uses the `task_id` resume path.

---

## 3. Architectural Analysis Against References

### 3.1 LangGraph Pregel — Subgraph Pattern

LangGraph's `PregelLoop` handles subgraphs by:
- **Namespace isolation**: Each subgraph gets a `checkpoint_ns` separator ([loop.ts:425–435](file:///D:/langgraphjs/libs/langgraph-core/src/pregel/loop.ts#L425-L435))
- **Channel-mediated returns**: Subgraph results flow through channel writes (`putWrites`), not direct function returns
- **Tracked promises**: `checkpointerPromises` set with cleanup tracking ([loop.ts:276–301](file:///D:/langgraphjs/libs/langgraph-core/src/pregel/loop.ts#L276-L301))

**Comparison with LiteAI**: LangGraph's channel abstraction (`BaseChannel` → `putWrites` → `_applyWrites`) is an implementation detail of their DAG-of-stateless-nodes architecture — it is the routing mechanism for a fundamentally different execution model, not a capability that LiteAI is missing. Specifically:

- **Time-travel / backward execution**: LiteAI's `Checkpointer` interface already provides the replay surface. [Phase 5](file:///d:/liteai/roadmap/engine-loop-decoupling/05-backward-execution.md) addresses this directly. Channels are how LangGraph routes data between nodes within a step; checkpoints are how both systems enable replay across steps.
- **Distributed execution**: LangGraph's `RemoteGraph` is a separate concern from channels. If LiteAI needs multi-process subagents, it would come from the `@liteagent/loop` extraction work, not from adopting a channel model.
- **Promise tracking**: The `PromiseTracker` in LiteAI correctly mirrors LangGraph's `checkpointerPromises` pattern.

### 3.2 Claude Code — `runAgent` Generator Pattern

Claude Code's `runAgent` ([runAgent.ts](file:///D:/claude-code/src/tools/AgentTool/runAgent.ts)):
- Returns an `AsyncGenerator<Message, void>`
- Full lifecycle management in `finally` block (MCP cleanup, hook cleanup, perfetto, etc.)
- Persistence is fire-and-forget sidechain recording (`recordSidechainTranscript`)

**Key insight**: While `runAgent` is a generator that yields messages, those messages flow to the **UI display layer** (the Ink TUI renderer), not to the parent agent's LLM context. The parent agent (the LLM) only ever sees the final `tool_result` block after the generator completes. This is the same dual-consumer model as LiteAI.

### 3.3 Dual-Consumer Model (Both Systems)

Both LiteAI and Claude Code separate two consumers of subagent output:

| Consumer | What it needs | LiteAI | Claude Code |
|---|---|---|---|
| **UI** (live display) | Streaming progress as subagent works | Child session's SSE stream (child has its own `sessionID`, UI subscribes independently) | `runAgent` generator yields to Ink TUI renderer |
| **Parent agent** (LLM) | Final result only | `SessionResult` returned by `runSubagent()` | `tool_result` block after generator completes |

The architectures are functionally equivalent. LiteAI achieves the same separation by giving the child its own `sessionID` + `SqliteCheckpointer` for live UI streaming, while returning only the batch `SessionResult` to the parent agent.

> [!TIP]
> **Future consideration**: If LiteAI ever needs the parent *agent* (not UI) to react to *intermediate* subagent outputs (e.g., early abort based on partial results), the current batch pattern would need to evolve toward a generator or observable pattern.

---

## 4. Quality & Correctness Findings

### 4.1 ✅ Strong: Error Handling in `task.ts`

The `TaskTool` now has explicit, graceful handling for all 3 `SessionResult` states:
- `ok` → extracts text/yield_turn summary → wraps in `<task_result>`
- `error` → formats error message → wraps in `<task_result_error>` (parent can recover)
- `aborted` → wraps in `<task_result_aborted>`

This is superior to the pre-refactor exception-based flow and aligns with the fail-fast protocol (errors surface, don't crash).

### 4.2 ✅ Strong: `Bus.publish` correctly scoped

The only remaining `Bus.publish` is in the top-level `loop()` function (line 890), which is the **root session entry point** — not in `runSubagent`. This means:
- Root sessions still publish errors to the TUI/SSE via Bus
- Subagent errors are returned directly to the parent (no Bus side-effects)

This is exactly correct.

### 4.3 ⚠️ Minor: `runSubagent` noReply early return

At [loop.ts:161–163](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L161-L163):

```typescript
if (input.noReply === true) {
  return { status: "ok" } as SessionResult
}
```

This returns `{ status: "ok" }` **without a `message` property**. The `SessionResult` type for `ok` requires `message: Message.WithParts`. The `as SessionResult` cast masks a type violation. In practice `noReply` is unlikely for subagents, but the cast is technically unsound.

### 4.4 ⚠️ Minor: `runSubagent` session busy handling

At [loop.ts:167–169](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L167-L169):

```typescript
if (!abort) {
  return { status: "error", error: new Error("Session busy") } as SessionResult
}
```

Unlike `loop()` which queues callbacks for busy sessions, `runSubagent` returns an immediate error. This is a correct design decision (subagents shouldn't queue), but worth noting that the behavior differs between the two entry points.

### 4.5 ✅ Strong: In-memory message lookup

The `ctx.messages.findLast()` pattern at [task.ts:51](file:///d:/liteai/packages/core/src/tool/task.ts#L51) is clean and correct. The `msgsBuffer` is always populated by the time tool execution runs, so the lookup is deterministic.

---

## 5. Spec Artifacts — Staleness Assessment

| Artifact | Fresh? | Notes |
|---|---|---|
| `spec.md` | ✅ | Acceptance scenarios still valid |
| `plan.md` | ⚠️ | Claims changes to `query.ts` and `streaming-tool-executor.ts` — no changes were needed |
| `data-model.md` | ✅ | `SessionResult` type matches implementation |
| `explanation.md` | ✅ | Code replacement instructions match actual changes |
| `quickstart.md` | ⚠️ | Example code shows `initialMessages` parameter on `runSession` which doesn't exist |
| `research.md` | ✅ | All 3 decisions correctly implemented |
| `tasks.md` | ✅ | All tasks completed, task descriptions match actual work |
| Roadmap `04-*` | ⚠️ | Files-to-change table stale; analysis task #3 (fork/branch) unresolved |

---

## 6. Recommendations

### Must Address

1. **Fix the `noReply` type violation** in `runSubagent` — either make `message` optional on `SessionResult.ok`, or throw an error if `noReply` is passed to `runSubagent` (it's semantically invalid for subagent invocations).

### Should Address

2. **Update stale artifacts**:
   - `plan.md`: Remove `query.ts` and `streaming-tool-executor.ts` from scope, or add a note that they needed no changes
   - `quickstart.md`: Fix the `runSession` example to show `runSubagent` (the actual API)

### Consider

3. **Mark spec status as `Implemented`** — currently says `Draft`.
