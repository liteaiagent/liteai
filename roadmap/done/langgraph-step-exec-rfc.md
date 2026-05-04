# LiteAI vs LangGraph: Architecture Evaluation

> [!CAUTION]
> **SUPERSEDED** — This RFC has been superseded by the [`engine-loop-decoupling`](../engine-loop-decoupling/) roadmap.
>
> **Conclusions proven incorrect:**
> - §5 "Persistent Checkpointing — ❌ Already Have It" — The loop is *coupled to* the DB, not *checkpointed by* it. See [00-analysis.md](../engine-loop-decoupling/00-analysis.md) §1.
> - §2 "State = message DB (single source of truth)" — DB-as-source-of-truth during forward execution is the root cause of the crash.
>
> **Recommendations absorbed into the new roadmap:**
> - §3 Step Execution & Pause → [05-backward-execution.md Feature A](../engine-loop-decoupling/05-backward-execution.md)
> - §4 Step-Back → [05-backward-execution.md Feature B](../engine-loop-decoupling/05-backward-execution.md)
> - §6 Time Travel (fork + re-execute) → [05-backward-execution.md Feature C](../engine-loop-decoupling/05-backward-execution.md)
> - §2 Step Context / Trace formalization → [05-backward-execution.md Feature D](../engine-loop-decoupling/05-backward-execution.md)

> [!NOTE]
> This is a **design-concept evaluation only**. Refactoring effort is explicitly out of scope.

---

## Executive Summary

LiteAI already implements the **substance** of most LangGraph concepts — just using different primitives. The question isn't "are we missing these features?" but rather "would formalizing them add value?" The answer is nuanced:

| LangGraph Concept | LiteAI Equivalent | Add It? | Why |
|---|---|---|---|
| Graph + Nodes | `while(true)` in [loop.ts](../../src/session/prompt/loop.ts) | ❌ No | Identical in practice, simpler code |
| Conditional Edges | `if/else` routing (compaction/subtask/normal) | ❌ No | Already clean and readable |
| State Object | Message DB + local vars + SessionStatus | ⚠️ Partial | Formalize "step context" only |
| Step Execution & Pause | AbortController (coarse) | ✅ **Yes** | High value for debugging & UX |
| Step-Back | Not implemented | ✅ **Yes** | Re-execute from a prior step |
| Persistent Checkpointing | SQLite messages + Git snapshots | ❌ No | Already fault-tolerant |
| HITL (Human-in-the-Loop) | PermissionNext | ❌ No | Already excellent |
| Time Travel | `Session.fork()` + `Snapshot.revert()` | ⚠️ Enhance | Add re-execution with different params |
| State Forking | `Session.fork()` | ❌ No | Already implemented |

---

## Detailed Analysis

### 1. The "Graph" — Already a While Loop ❌

LangGraph's core abstraction is a directed graph where nodes are functions and edges are transitions. LiteAI's [loop.ts](../../src/session/prompt/loop.ts#L215-L579) **is** that graph:

```
┌──────────────────────────────────────────────────────┐
│                   while (true)                       │
│                                                      │
│  ┌───────────┐    ┌───────────┐    ┌──────────────┐  │
│  │ Read Msgs │───►│ Route     │───►│ Compaction   │  │
│  │ from DB   │    │ (if/else) │    │ Subtask      │  │
│  └───────────┘    └───────────┘    │ Normal LLM   │  │
│       ▲                            └──────┬───────┘  │
│       │                                   │          │
│       │          ┌───────────┐            │          │
│       └──────────┤ continue/ │◄───────────┘          │
│                  │ stop/     │                       │
│                  │ compact   │                       │
│                  └───────────┘                       │
└──────────────────────────────────────────────────────┘
```

The routing logic at [loop.ts:297-333](../../src/session/prompt/loop.ts#L297-L333) is exactly LangGraph's "conditional edges":

```typescript
// pending subtask → processSubtask()
if (task?.type === "subtask") { ... continue }

// pending compaction → SessionCompaction.process()
if (task?.type === "compaction") { ... continue }

// context overflow → auto-compaction
if (lastFinished && isOverflow) { ... continue }

// normal processing → SessionProcessor
```

**Verdict**: A graph abstraction would add vocabulary but no capability. The while loop is clearer for a linear agent flow.

---

### 2. State Object ⚠️ Partial Value

#### What LangGraph Does
LangGraph defines a typed [State](../../src/session/prompt/loop.ts#39-49) that flows through every node. Nodes can read and mutate it. A "reducer" defines how state updates merge.

#### What LiteAI Does Instead
LiteAI's state is **distributed across multiple systems**:

| State Component | Where It Lives | Persistence |
|---|---|---|
| Conversation history | SQLite `MessageTable` + `PartTable` | ✅ Persistent |
| Session metadata | SQLite `SessionTable` | ✅ Persistent |
| File state (snapshots) | Separate git repo | ✅ Persistent |
| Loop progress | Local var `step` in loop | ❌ Ephemeral |
| Structured output | Local var `structuredOutput` | ❌ Ephemeral |
| Active/busy status | In-memory `SessionStatus` | ❌ Ephemeral |
| Abort signal | In-memory `AbortController` | ❌ Ephemeral |
| Resolved tools | Computed per step | ❌ Ephemeral |
| Resolved system prompt | Computed per step | ❌ Ephemeral |

#### Should You Add A Formal State Object?

**No, for the state *container*.** Here's why:

1. **LLM agents are append-only by nature.** The conversation IS the state. Unlike a classical state machine where state is a compact object that transforms, an LLM agent's state is the ever-growing message history. Your message DB already models this perfectly.

2. **A parallel state object creates sync risk.** If you have both `state.currentAgent` AND `lastUser.agent` derived from messages, they can diverge. The message DB is the single source of truth — that's cleaner.

3. **LangGraph's state is a workaround.** LangGraph needs an explicit state because it runs nodes as independent functions that can't share scope. LiteAI's loop has shared lexical scope — `lastUser`, `lastAssistant`, `step` are all just local variables. This is *simpler*.

**Yes, for "Step Context" (which Trace already captures):**

Your [Trace system](../../src/session/prompt/loop.ts#L482-L518) already records exactly the right data per step:
- Agent name
- Model + provider
- System prompt (with hash dedup)
- Tool schemas (with hash dedup)
- Message context IDs
- Timing

This IS your step state. The recommendation: **formalize `Trace` as the "step checkpoint"** rather than introducing a separate state object. It's already doing the right thing — just make it a first-class concept.

---

### 3. Step Execution & Pause ✅ Add This

This is the **highest-value addition** from LangGraph's playbook.

#### Current Behavior
The loop runs continuously from user prompt to final response. The only intervention points are:
- **Cancel** (abort entirely) — [loop.ts:188-200](../../src/session/prompt/loop.ts#L188-L200)
- **Permission gate** (blocks on tool approval) — via PermissionNext
- **Doom loop detection** — [processor.ts:179-201](../../src/session/prompt/loop.ts#L179-L201)

There's no way to say: "Execute one step, show me the results, let me decide whether to continue."

#### What Step Execution Enables

```
User: "Refactor the auth module"

[Step 1] Agent reads files → PAUSE
  User reviews: "Good, it found the right files. Continue."

[Step 2] Agent writes changes → PAUSE
  User reviews: "Wait, that approach is wrong. Step back."

[Step 1 replayed] Agent reads files → PAUSE
  User: "Try using a middleware pattern instead" (injects guidance)

[Step 2] Agent writes different changes → PAUSE
  User: "Perfect. Continue."

[Step 3] Agent runs tests → FINISH
```

#### Why This Fits Your Design

Your loop already has natural step boundaries — each iteration of `while(true)` is a step. The processor's [process()](../../src/session/processor.ts#50-479) return value (`"continue"` / `"stop"` / `"compact"`) already signals step completion. You'd need:

1. **A "step" mode flag** on the session or prompt input
2. **Yield control between loop iterations** instead of immediately continuing
3. **A "resume" API** that continues from where it paused

The `SessionStatus` already has states for this (`idle`, `busy`, `retry`). Adding `paused` would fit naturally:

```typescript
// Conceptual — not a code proposal
export const Info = z.union([
  z.object({ type: z.literal("idle") }),
  z.object({ type: z.literal("busy") }),
  z.object({ type: z.literal("retry"), ... }),
  z.object({ type: z.literal("paused"), step: z.number() }),  // NEW
])
```

---

### 4. Step-Back ✅ Add This

Step-back is the ability to "undo the last LLM step and re-execute." This is different from [revert()](../../src/session/revert.ts#24-81) which undoes file changes.

#### Current Behavior
- [SessionRevert](../../src/session/revert.ts) reverts **file changes** to a previous point
- [Session.fork()](../../src/session/index.ts#L240-L281) copies a session up to a message boundary

Neither lets you "go back to step N and re-run with the same (or different) inputs."

#### What Step-Back Requires

1. **Delete messages after the step-back point** (you already have `removeMessage()`)
2. **Restore file state to the step-start snapshot** (you already have `Snapshot.restore()`)
3. **Re-enter the loop** (you already have `loop({ resume_existing: true })`)

The building blocks exist. The missing piece is orchestrating them together:

```
step-back(sessionID, messageID) =
  1. Snapshot.restore(step-start snapshot for messageID)
  2. Delete all messages after messageID
  3. Resume the loop → re-executes from that point
```

The `step-start` and `step-finish` parts in your processor ([processor.ts:269-325](../../src/session/processor.ts#L269-L325)) already capture snapshots at step boundaries. This data is already persisted.

---

### 5. Persistent Checkpointing (Fault Tolerance) ❌ Already Have It

#### LangGraph's Approach
After each node execution, LangGraph serializes the entire state to a persistent store. If the process crashes, it resumes from the last checkpoint.

#### LiteAI's Approach (Already Fault-Tolerant)

Your system is **inherently checkpoint-based** because:

1. **Every message and part is persisted to SQLite immediately** via `Session.updateMessage()` and `Session.updatePart()` — not batched, not buffered.

2. **The loop re-derives its state from the DB on every iteration.** Look at [loop.ts:242-259](../../src/session/prompt/loop.ts#L242-L259):
   ```typescript
   while (true) {
     let msgs = await Message.filterCompacted(Message.stream(sessionID))
     let lastUser, lastAssistant, lastFinished  // re-derived every iteration
   ```
   
   If the process crashes mid-step, the next `loop()` call will:
   - Read all persisted messages from DB
   - See the incomplete assistant message (no `finish` reason)
   - Continue from there

3. **File state is tracked via git snapshots** at step boundaries.

**Verdict**: You effectively DO have persistent checkpointing — it's just not labeled as such. Each `updateMessage`/`updatePart` call is a checkpoint. The DB is your checkpoint store. Adding a formal checkpoint layer would be redundant.

---

### 6. Time Travel & State Forking ⚠️ Enhance

#### What You Have
- **`Session.fork(messageID)`**: Copies a session up to a specific message. Creates a new session branch.
- **`SessionRevert.revert(messageID)`**: Rolls back **file changes** after a message. Doesn't delete messages.
- **`SessionRevert.unrevert()`**: Restores file state to before the revert.

#### What's Missing: Re-Execution With Different Parameters

The most valuable "time travel" scenario for a coding agent isn't "replay the exact same execution" — it's **"go back to this point and try again differently."** Scenarios:

1. *"The agent went down the wrong path at step 3. Go back to step 2 and try with a different model."*
2. *"The agent's approach was wrong. Go back to the planning step and inject different guidance."*
3. *"The agent made a mistake in the edit. Go back to before the edit and let me give it more context."*

Your `fork()` already handles #1 and #3. What would enhance it:
- **Fork + auto-resume**: Fork the session to a point, then automatically re-enter the loop (currently fork just copies messages, doesn't re-execute).
- **Fork + parameter override**: Fork and change the model/agent for the next step.

This is essentially `step-back` from §4 combined with `fork` — and the combination is more useful than either alone.

---

## Recommendation Matrix

### ✅ Add: Step Execution & Pause + Step-Back

These two features together create a **"debugger for agent behavior"** — which is genuinely novel and high-value for a coding agent. The implementation path is clean because your architecture already has:
- Natural step boundaries (loop iterations)
- Step-level snapshots (git write-tree at step-start/step-finish)
- Step-level traces (Trace records per step)
- Message persistence per step (SQLite)
- Session state signaling (SessionStatus bus events)

### ⚠️ Formalize: Step Context (via Trace)

Don't add a new state object. Instead, promote your existing Trace system to be the "step checkpoint" concept. It already captures exactly the right information — agent, model, system prompt, tools, messages, timing. Making it queryable (e.g., "give me the context of step 3") enables step-back and debugging.

### ❌ Skip: Formal State Object, Checkpoint System, Graph Abstraction

These would add complexity without capability because:
- **State = your message DB** (single source of truth, append-only, already persistent)
- **Checkpoints = your per-message SQLite writes** (already crash-recoverable)
- **Graph = your while loop** (simpler, equivalent, and more readable for a linear agent flow)

---

## Why LiteAI's Model Is Actually Better For This Domain

LangGraph was designed for **arbitrary multi-agent workflows** — think orchestrating 5 different specialized agents in a complex DAG with fan-out/fan-in, conditional routing, and parallel execution.

LiteAI is a **coding agent**. Its workflow is fundamentally:

```
User → [Read → Think → Act → Observe]* → Response
```

This is a **linear loop with occasional branching** (sub-agents, compaction), not a complex graph. Your architecture reflects this reality:

1. **Messages as state**: Perfect for LLM agents. The conversation IS the state.
2. **Git snapshots**: Perfect for coding agents. File changes are the side effects.
3. **SQLite persistence**: Perfect for crash recovery. Every write is a checkpoint.
4. **Bus/Events**: Perfect for UI reactivity. Every state change is observable.

The only thing worth borrowing from LangGraph is the **developer UX of step-by-step execution** — the ability to pause, inspect, step back, and re-execute. The underlying infrastructure doesn't need to change.

---

## Summary

> **LangGraph gives you a vocabulary. LiteAI already has the semantics.**
> 
> The one thing worth adding is **step-level control** (pause, step-back, re-execute) — which is an orchestration concern on top of your existing loop, not a fundamental architecture change.
