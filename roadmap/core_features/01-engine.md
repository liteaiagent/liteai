# LiteAI Core — Engine & Session Loop

> **Scope:** `src/session/`, `src/session/engine/`, `src/permission/`, `src/tool/`, `src/format/`, `src/question/`, `src/patch/`  
> **Last audited:** 2026-05-09

---

## 1. Session Lifecycle

| Feature | Status | Source |
|---|:---:|---|
| Session CRUD | ✅ | [`session/index.ts`](../../packages/core/src/session/index.ts) |
| Session Schema (ID types) | ✅ | [`session/schema.ts`](../../packages/core/src/session/schema.ts) |
| Session SQL persistence | ✅ | [`session/session.sql.ts`](../../packages/core/src/session/session.sql.ts) |
| Session Status (idle/busy) | ✅ | [`session/status.ts`](../../packages/core/src/session/status.ts) |
| Session Events (SSE) | ✅ | [`session/events.ts`](../../packages/core/src/session/events.ts) |
| Session Touch (last-active) | ✅ | [`session/index.ts`](../../packages/core/src/session/index.ts) |
| Session Tags | ✅ | [`session/index.ts`](../../packages/core/src/session/index.ts) |
| Session Archive | ✅ | [`session/index.ts`](../../packages/core/src/session/index.ts) |
| Session Fork | ✅ | [`agent/fork.ts`](../../packages/core/src/agent/fork.ts) |
| Session Transcript | ✅ | [`session/transcript.ts`](../../packages/core/src/session/transcript.ts) |

---

## 2. Engine Loop (Core Orchestrator)

| Feature | Status | Source |
|---|:---:|---|
| Main Loop (`loop()`) | ✅ | [`engine/loop.ts`](../../packages/core/src/session/engine/loop.ts) |
| Query Loop (generator) | ✅ | [`engine/query.ts`](../../packages/core/src/session/engine/query.ts) |
| Event-sourced persistence | ✅ | [`engine/persister.ts`](../../packages/core/src/session/engine/persister.ts) |
| Streaming tool executor | ✅ | [`engine/streaming-tool-executor.ts`](../../packages/core/src/session/engine/streaming-tool-executor.ts) |
| User message creation | ✅ | [`engine/input.ts`](../../packages/core/src/session/engine/input.ts) |
| System prompt assembly | ✅ | [`engine/system.ts`](../../packages/core/src/session/engine/system.ts) |
| Instruction prompt (per-turn) | ✅ | [`engine/instruction.ts`](../../packages/core/src/session/engine/instruction.ts) |
| Tool pipeline | ✅ | [`engine/pipeline.ts`](../../packages/core/src/session/engine/pipeline.ts) |
| Tool resolution | ✅ | [`engine/tools.ts`](../../packages/core/src/session/engine/tools.ts) |
| Shell detection | ✅ | [`engine/shell.ts`](../../packages/core/src/session/engine/shell.ts) |
| Command handling | ✅ | [`engine/command.ts`](../../packages/core/src/session/engine/command.ts) |
| Namespace isolation | ✅ | [`engine/namespace.ts`](../../packages/core/src/session/engine/namespace.ts) |
| Section parser | ✅ | [`engine/section-parser.ts`](../../packages/core/src/session/engine/section-parser.ts) |
| Section registry | ✅ | [`engine/section-registry.ts`](../../packages/core/src/session/engine/section-registry.ts) |
| Telemetry (per-turn spans) | ✅ | [`engine/telemetry.ts`](../../packages/core/src/session/engine/telemetry.ts) |
| Safe abort (Bun workaround) | ✅ | [`engine/loop.ts`](../../packages/core/src/session/engine/loop.ts) `safeAbort()` |

---

## 3. Checkpointing & State

| Feature | Status | Source |
|---|:---:|---|
| SQLite Checkpointer | ✅ | [`engine/loop/checkpointer.ts`](../../packages/core/src/session/engine/loop/checkpointer.ts) |
| Checkpoint Store Manager | ✅ | [`engine/loop/checkpoint-store.ts`](../../packages/core/src/session/engine/loop/checkpoint-store.ts) |
| Promise Tracker | ✅ | [`engine/loop/promise-tracker.ts`](../../packages/core/src/session/engine/loop/promise-tracker.ts) |
| Step-Pause Latch (HITL) | ✅ | [`engine/loop/step-latch.ts`](../../packages/core/src/session/engine/loop/step-latch.ts) |

---

## 4. Loop Safety & Recovery

| Feature | Status | Source |
|---|:---:|---|
| Loop Detection | ✅ | [`engine/loop-detection.ts`](../../packages/core/src/session/engine/loop-detection.ts) |
| Thinking Loop Detector | ✅ | [`engine/thinking-loop-detector.ts`](../../packages/core/src/session/engine/thinking-loop-detector.ts) |
| Correction Injector | ✅ | [`engine/correction-injector.ts`](../../packages/core/src/session/engine/correction-injector.ts) |
| Stop-Drift Detection | ✅ | [`engine/stop-drift.ts`](../../packages/core/src/session/engine/stop-drift.ts) |
| Plan Reminder | ✅ | [`engine/plan-reminder.ts`](../../packages/core/src/session/engine/plan-reminder.ts) |
| Escalation (max retries) | ✅ | [`engine/loop.ts`](../../packages/core/src/session/engine/loop.ts) `loopDetectionCount >= 3` |

---

## 5. Plan Mode

| Feature | Status | Source |
|---|:---:|---|
| Plan Mode State (in-memory ref) | ✅ | [`session/plan-mode-state.ts`](../../packages/core/src/session/plan-mode-state.ts) |
| Plan Enter / Exit Tools | ✅ | [`tool/plan.ts`](../../packages/core/src/tool/plan.ts) |
| Plan Stop-Drift (correction) | ✅ | [`engine/stop-drift.ts`](../../packages/core/src/session/engine/stop-drift.ts) |
| Plan Reminder Injection | ✅ | [`engine/plan-reminder.ts`](../../packages/core/src/session/engine/plan-reminder.ts) |

---

## 6. Step Mode (HITL)

| Feature | Status | Source |
|---|:---:|---|
| Step-by-step execution | ✅ | [`engine/loop.ts`](../../packages/core/src/session/engine/loop.ts) `stepModeRef` |
| Step Pause Latch | ✅ | [`engine/loop/step-latch.ts`](../../packages/core/src/session/engine/loop/step-latch.ts) |
| Resume Step API | ✅ | [`engine/loop.ts`](../../packages/core/src/session/engine/loop.ts) `resumeStepMode()` |

---

## 7. Context Compaction

| Feature | Status | Source |
|---|:---:|---|
| Compaction Orchestrator | ✅ | [`engine/compaction-orchestrator.ts`](../../packages/core/src/session/engine/compaction-orchestrator.ts) |
| Compaction Task | ✅ | [`session/tasks/compaction.ts`](../../packages/core/src/session/tasks/compaction.ts) |
| Context Breakdown | ✅ | [`session/tasks/context-breakdown.ts`](../../packages/core/src/session/tasks/context-breakdown.ts) |
| Overflow Detection | ✅ | [`engine/loop.ts`](../../packages/core/src/session/engine/loop.ts) `control:overflow` |
| Auto-compact (token threshold) | ✅ | [`engine/persister.ts`](../../packages/core/src/session/engine/persister.ts) → `compact` flush result |

---

## 8. Session Tasks (Background LLM)

| Feature | Status | Source |
|---|:---:|---|
| Session Title Generation | ✅ | [`session/tasks/title.ts`](../../packages/core/src/session/tasks/title.ts) |
| Session Summary | ✅ | [`session/tasks/summary.ts`](../../packages/core/src/session/tasks/summary.ts) |
| Session Description | ✅ | [`session/tasks/description.ts`](../../packages/core/src/session/tasks/description.ts) |

---

## 9. Sub-Agents

| Feature | Status | Source |
|---|:---:|---|
| Sub-agent Execution | ✅ | [`engine/loop.ts`](../../packages/core/src/session/engine/loop.ts) `runSubagent()` |
| Subtask Processing | ✅ | [`engine/loop.ts`](../../packages/core/src/session/engine/loop.ts) `processSubtask()` |
| SendMessage Tool (spawn) | ✅ | [`tool/send_message.ts`](../../packages/core/src/tool/send_message.ts) |
| Task Tool | ✅ | [`tool/task.ts`](../../packages/core/src/tool/task.ts) |

---

## 10. Message System

| Feature | Status | Source |
|---|:---:|---|
| Message Model (parts-based) | ✅ | [`session/message.ts`](../../packages/core/src/session/message.ts) (30KB) |
| LLM Interaction | ✅ | [`session/llm.ts`](../../packages/core/src/session/llm.ts) |
| Message Processor | ✅ | [`session/processor.ts`](../../packages/core/src/session/processor.ts) |
| Retry Logic | ✅ | [`session/retry.ts`](../../packages/core/src/session/retry.ts) |
| Revert (undo last turn) | ✅ | [`session/revert.ts`](../../packages/core/src/session/revert.ts) |
| Step-Back | ✅ | [`session/step-back.ts`](../../packages/core/src/session/step-back.ts) |
| Todo (session-level tasks) | ✅ | [`session/todo.ts`](../../packages/core/src/session/todo.ts) |

---

## 11. Permission System

| Feature | Status | Source |
|---|:---:|---|
| Permission Service | ✅ | [`permission/service.ts`](../../packages/core/src/permission/service.ts) |
| Permission Schema | ✅ | [`permission/schema.ts`](../../packages/core/src/permission/schema.ts) |
| Arity Classifier | ✅ | [`permission/arity.ts`](../../packages/core/src/permission/arity.ts) |
| Risk Classifier | ✅ | [`permission/classifier.ts`](../../packages/core/src/permission/classifier.ts) |
| Permission Next (v2) | ✅ | [`permission/next.ts`](../../packages/core/src/permission/next.ts) |
| Sandbox Mode | ✅ | [`permission/sandbox.ts`](../../packages/core/src/permission/sandbox.ts) |
| Project-level persistence | ✅ | [`session/session.sql.ts`](../../packages/core/src/session/session.sql.ts) `PermissionTable` |

> **Architecture:** Aligned with Claude Code's permission model:
> - **Durable rules** → `PermissionTable` (project-keyed, cross-session)
> - **Agent-level rules** → `agent.permission` (in-memory, per agent definition)
> - **Session-scoped rules** → runtime-only (no DB persistence)
>
> **Future (Phase 2):** Consolidate "always allow" rules from `PermissionTable` (SQLite) to project settings files (`.liteai/settings.json`) for full Claude Code parity.

---

## 12. Native Tool Inventory

| Tool ID | Status | Source |
|---|:---:|---|
| `read` | ✅ | [`tool/read.ts`](../../packages/core/src/tool/read.ts) |
| `write` | ✅ | [`tool/write.ts`](../../packages/core/src/tool/write.ts) |
| `edit` | ✅ | [`tool/edit.ts`](../../packages/core/src/tool/edit.ts) |
| `multiedit` | ✅ | [`tool/multiedit.ts`](../../packages/core/src/tool/multiedit.ts) |
| `apply_patch` | ✅ | [`tool/apply_patch.ts`](../../packages/core/src/tool/apply_patch.ts) |
| `run_command` | ✅ | [`tool/run_command.ts`](../../packages/core/src/tool/run_command.ts) |
| `command_status` | ✅ | [`tool/command_status.ts`](../../packages/core/src/tool/command_status.ts) |
| `send_command_input` | ✅ | [`tool/send_command_input.ts`](../../packages/core/src/tool/send_command_input.ts) |
| `glob` | ✅ | [`tool/glob.ts`](../../packages/core/src/tool/glob.ts) |
| `grep` | ✅ | [`tool/grep.ts`](../../packages/core/src/tool/grep.ts) |
| `ls` | ✅ | [`tool/ls.ts`](../../packages/core/src/tool/ls.ts) |
| `codesearch` | ✅ | [`tool/codesearch.ts`](../../packages/core/src/tool/codesearch.ts) |
| `websearch` | ✅ | [`tool/websearch.ts`](../../packages/core/src/tool/websearch.ts) |
| `webfetch` | ✅ | [`tool/webfetch.ts`](../../packages/core/src/tool/webfetch.ts) |
| `ask_user` | ✅ | [`tool/ask_user.ts`](../../packages/core/src/tool/ask_user.ts) |
| `send_message` | ✅ | [`tool/send_message.ts`](../../packages/core/src/tool/send_message.ts) |
| `task` | ✅ | [`tool/task.ts`](../../packages/core/src/tool/task.ts) |
| `plan_enter` / `plan_exit` | ✅ | [`tool/plan.ts`](../../packages/core/src/tool/plan.ts) |
| `skill` | ✅ | [`tool/skill.ts`](../../packages/core/src/tool/skill.ts) |
| `memory` (read/write/edit) | ✅ | [`tool/memory.ts`](../../packages/core/src/tool/memory.ts) |
| `todo` (write) | ✅ | [`tool/todo.ts`](../../packages/core/src/tool/todo.ts) |
| `yield_turn` | ✅ | [`tool/yield_turn.ts`](../../packages/core/src/tool/yield_turn.ts) |
| `batch` (experimental) | ✅ | [`tool/batch.ts`](../../packages/core/src/tool/batch.ts) |
| `lsp` (disabled) | 🔶 | [`tool/lsp.ts`](../../packages/core/src/tool/lsp.ts) — registered but commented out |
| Tool Registry | ✅ | [`tool/registry.ts`](../../packages/core/src/tool/registry.ts) |
| Tool Truncation | ✅ | [`tool/truncation.ts`](../../packages/core/src/tool/truncation.ts) |
| Invalid Tool Handler | ✅ | [`tool/invalid.ts`](../../packages/core/src/tool/invalid.ts) |
| External Dir Guard | ✅ | [`tool/external-directory.ts`](../../packages/core/src/tool/external-directory.ts) |
| Tool Profile (Plan/Fast) | ✅ | [`tool/registry.ts`](../../packages/core/src/tool/registry.ts) `toolProfile` filter |

---

## 13. Output Formatting

| Feature | Status | Source |
|---|:---:|---|
| Structured Output | ✅ | [`format/index.ts`](../../packages/core/src/format/index.ts) |
| Output Formatter | ✅ | [`format/formatter.ts`](../../packages/core/src/format/formatter.ts) |

---

## 14. Patch System

| Feature | Status | Source |
|---|:---:|---|
| Unified Patch Engine | ✅ | [`patch/index.ts`](../../packages/core/src/patch/index.ts) (21KB) |

---

## 15. Question Service (HITL Prompt)

| Feature | Status | Source |
|---|:---:|---|
| Question Queue | ✅ | [`question/service.ts`](../../packages/core/src/question/service.ts) |
| Question Schema | ✅ | [`question/schema.ts`](../../packages/core/src/question/schema.ts) |
| Question Route | ✅ | [`question/index.ts`](../../packages/core/src/question/index.ts) |

---

## Summary

| Category | ✅ | 🔶 | ❌ | Total |
|---|:---:|:---:|:---:|:---:|
| Session Lifecycle | 10 | 0 | 0 | 10 |
| Engine Loop | 16 | 0 | 0 | 16 |
| Checkpointing | 4 | 0 | 0 | 4 |
| Loop Safety | 6 | 0 | 0 | 6 |
| Plan Mode | 4 | 0 | 0 | 4 |
| Step Mode (HITL) | 3 | 0 | 0 | 3 |
| Context Compaction | 5 | 0 | 0 | 5 |
| Session Tasks | 3 | 0 | 0 | 3 |
| Sub-Agents | 4 | 0 | 0 | 4 |
| Message System | 7 | 0 | 0 | 7 |
| Permission System | 7 | 0 | 0 | 7 |
| Native Tools | 25 | 1 | 0 | 26 |
| Output Formatting | 2 | 0 | 0 | 2 |
| Patch System | 1 | 0 | 0 | 1 |
| Question Service | 3 | 0 | 0 | 3 |
| **Total** | **100** | **1** | **0** | **101** |
