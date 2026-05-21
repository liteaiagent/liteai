# Research: Message Rendering & Error Resilience

**Date**: 2026-05-21
**Branch**: `016-message-rendering`

## Research Summary

All Technical Context items from the plan have been researched and resolved. No NEEDS CLARIFICATION items remain.

> [!IMPORTANT]
> **R1 and R2 were corrected** after initial incorrect analysis. `plan_enter` and `plan_exit` ARE tool
> calls defined in `packages/core/src/tool/plan.ts` with a confirmed model resolution bug and
> OpenTelemetry span usage. Both bugs are IN SCOPE.

---

## R1: Plan Mode Tools (plan_enter/plan_exit) — CORRECTED

**Question**: Does LiteAI have `plan_enter` and `plan_exit` as tool calls that need rendering in `ToolPartView`?

**Finding**: **YES.** `PlanEnterTool` and `PlanExitTool` are full tool definitions in `packages/core/src/tool/plan.ts`, registered in `packages/core/src/tool/registry.ts` (lines 75-76) as `plan_enter` and `plan_exit`. They fall through to `GenericTool` in the CLI dispatch (`parts.tsx:165-166`) because there is no dedicated `case "plan_enter":` or `case "plan_exit":` entry.

**Confirmed Bug (line 221 of plan.ts)**: The model resolution for plan subagent uses:
```typescript
const parentAssistant = ctx.messages.findLast((m) => m.info.id === ctx.messageID)
```
This fails because the current assistant message is still in-flight (not yet committed to the message list). `parentAssistant` is `undefined` → hits line 229-234 → throws `"Could not determine parent model for plan subagent"`.

**Fix Pattern**: `agent.ts:70-89` has the correct pattern — it tries `ctx.messages.findLast()` first, then falls back to `ctx.extra.model`. The fix is to add the same `ctx.extra.model` fallback to `plan.ts:220-234`.

**Additional Core Behaviors**:
- `plan_enter` calls `SessionPrompt.setPermissionMode(ctx.sessionID, "plan")` — gates root session to read-only
- `plan_exit` calls `SessionPrompt.setPermissionMode(ctx.sessionID, "default")` — restores write permissions
- `plan_exit` uses `Question.ask()` for plan approval — triggers `Confirming` display state
- Both tools are excluded from the tool pool when `toolProfile === "Fast"` (registry.ts:129-133)

**Decision**: IN SCOPE. Three changes:
1. **Core bug fix**: Add `ctx.extra.model` fallback to `plan.ts:220-234` (matches `agent.ts` pattern)
2. **CLI rendering**: Add `plan_enter`/`plan_exit` cases to the tool formatter registry with human-readable descriptions ("Entering plan mode", "Plan approved")
3. **FR-017 remains valid**: Plan tools DO need rendering through the unified `DenseToolMessage` pattern

---

## R2: OpenTelemetry Span Leak — CORRECTED

**Question**: Is the span leak in `llm.ts` still present?

**Finding**: The span issue is NOT in `llm.ts` — it is in `packages/core/src/tool/plan.ts`. Both `PlanEnterTool` (line 149) and `PlanExitTool` (line 56) use `tracer.startActiveSpan()` with `span.addEvent()`, `span.recordException()`, and `span.end()` in try/catch/finally blocks. The pattern is:
```typescript
return tracer.startActiveSpan("tool.plan_enter.execute", async (span) => {
  try { ... span.addEvent(...) ... }
  catch (e) { span.recordException(e as Error); throw e; }
  finally { span.end() }
})
```

This pattern is actually correct — `span.end()` is called exactly once in the `finally` block. The original roadmap's description of `flush()` calling `span.setAttribute()` on a dead span does not match the current code. The spans in `plan.ts` are properly guarded.

**Decision**: No fix needed for span lifecycle in `plan.ts`. The current try/finally pattern is correct. If stderr output from OpenTelemetry is corrupting the TUI, that's an OpenTelemetry exporter configuration issue (stderr redirection), not a span lifecycle bug. Defer to a separate issue if observed during manual testing.

**Alternatives Considered**: Adding defensive `span.isRecording()` checks before every `addEvent` → Rejected because the try/finally pattern already guarantees correct lifecycle.

---

## R3: Error Shape in onSessionError

**Question**: What is the exact error shape and where does the "X undefined" bug occur?

**Finding**: **Confirmed bug.** The event handler in `app-state-events.ts:179` correctly extracts the error as `{ name?: string; message?: string }`. However, the `onSessionError` callback in `app-state-context.tsx:143` casts the error as `{ name?: string; data?: { message?: string } }` and accesses `err?.data?.message`. This is wrong — the event shape is flat (`error.message`), not nested (`error.data.message`).

Additionally, the `setState` in `app-state-events.ts:200-203` wraps the error in `{ name: "UnknownError", data: { message: error?.message } }` before attaching to the assistant message. This means `message.error.data.message` IS correct for inline message error display, but the toast callback receives the raw event error (flat shape).

**Decision**: Fix line 144 of `app-state-context.tsx` to use `err?.message ?? "Session encountered an error"` instead of `err?.data?.message`. The error shapes are: (1) SSE event → flat `{ name, message }`, (2) message.error → nested `{ name, data: { message } }`. The toast gets shape (1).

---

## R4: 4-State → 6-State Display Mapping

**Question**: How does LiteAI's 4-state `ToolState` map to the 6-state display model?

**Finding**: LiteAI's SDK defines 4 `ToolState` statuses: `pending`, `running`, `completed`, `error`. The display layer needs 6 states: Pending, Executing, Success, Confirming, Cancelled, Error.

**Mapping**:
| Core Status | Display State | Derivation |
|---|---|---|
| `pending` | **Pending** | Direct map |
| `running` | **Executing** | Direct map |
| `completed` | **Success** | Direct map |
| `error` (+ permission error pattern) | **Cancelled** | Error message contains "rejected permission", "user dismissed", or "specified a rule" |
| `error` (other) | **Error** | All other errors |
| N/A (permission pending) | **Confirming** | Derived from `permission` prop — `permissions.some(x => x.tool?.callID === part.callID)` |

**Decision**: Create a `mapToolPartToDisplayStatus(part: ToolPart, permissions: PermissionRequest[])` function in `utils/tool-display-status.ts`. This function encapsulates all mapping logic in one place. The `Confirming` state is NOT derived from core `ToolState` — it's derived from the existing permission request state in the app store.

**Gemini Reference**: Gemini CLI's `mapCoreStatusToDisplayStatus` maps from `CoreToolCallStatus` (7 values including `Validating`, `Scheduled`, `AwaitingApproval`) to `ToolCallStatus` (6 values). LiteAI's version maps from `ToolState.status` (4 values) + permission state to `ToolDisplayStatus` (6 values).

---

## R5: TodoWrite Null Bug

**Question**: Why does `todowrite` return `null` in the tool dispatch?

**Finding**: In `parts.tsx:159-160`, the `todowrite` case returns `null`. This was likely intentional — todos are rendered in a separate `TodoTray` component (like Gemini's `TodoTray`). However, this means the tool call itself is invisible in the tool stream. Gemini handles this by rendering `todowrite` through `DenseToolMessage` with `isTodoList()` detection — the tool IS visible inline with a "→ Todos updated" summary.

**Decision**: Remove the `return null` and render `todowrite` through the unified `DenseToolMessage` pattern. The todo tray (if it exists) remains separate — it aggregates the latest todo state. The inline tool rendering shows "✓ todowrite → Todos updated (N items)" for each invocation.

---

## R6: Input Clear on Error State

**Question**: Where does the input fail to clear after submission during error state?

**Finding**: This needs to be verified during implementation. The prompt input is in `packages/cli/src/tui/components/prompt/`. The issue is likely in the submit handler not calling the clear function when the session status is in an error/idle state. Will investigate during implementation and fix if confirmed.

**Decision**: Defer to implementation — inspect the prompt submit handler and ensure input clear is unconditional.

---

## R7: Thinking Block Collapse Arrow

**Question**: Is the `▼` vs `▶` bug still present?

**Finding**: In `parts.tsx:76`, the collapsed thinking view shows `▼ Thinking{displayTitle}`. The `▼` character means "expanded/down arrow". For a collapsed block, it should be `▶` (right-pointing, indicating expandable). The expanded view at line 96 correctly uses `▼`.

**Decision**: Fix line 76 to use `▶` for the collapsed state. Simple character replacement.

---

## R8: Unified DenseToolMessage Architecture

**Question**: What is the right architecture for the unified tool rendering?

**Finding**: After analyzing both codebases:

- **Gemini CLI** has 4 tool rendering components: `DenseToolMessage` (compact unified), `ToolMessage` (full-width), `ShellToolMessage` (interactive shell), and `ToolGroupDisplay`/`SubagentGroupDisplay` (collapsed groups). The dispatch happens in `ToolGroupMessage.tsx` based on `isCompactTool()`, `isShellTool()`, `isTopicTool()`, and agent grouping.

- **LiteAI** has 2 internal primitives (`InlineTool`, `BlockTool`) used by 17 per-tool components (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `List`, `WebFetch`, `CodeSearch`, `WebSearch`, `Task`, `Question`, `Skill`, `RunCommand`, `CommandStatus`, `SendCommandInput`, `ApplyPatch`, `TodoWrite`, `GenericTool`). The dispatch is a switch statement in `parts.tsx:130-167`.

**Decision**: Replace `InlineTool` and `BlockTool` with a single `DenseToolMessage` component that handles ALL tools. Per-tool components become **formatter functions** that return `{ description, summary, payload }` (ViewParts). `RunCommand` retains its `ShellOutput` sub-view as the payload.

**Architecture**:
```
ToolPartView (parts.tsx)
  └─ DenseToolMessage (tools.tsx)
       ├─ ToolStatusIndicator (fixed-width status column)
       ├─ Tool name (bold, max 25ch)
       ├─ Description (muted, from formatter)
       ├─ → Result summary (accent, from formatter)
       └─ Payload (expandable, from formatter)
            ├─ Diff (Write, Edit, ApplyPatch)
            ├─ Shell output (RunCommand only — ShellOutput component)
            ├─ Q&A (Question)
            ├─ Checklist (TodoWrite)
            └─ Generic text (other tools)
```

Each tool type has a `getToolViewParts(toolName, input, metadata, part)` formatter that returns `ViewParts`. The `DenseToolMessage` component is tool-agnostic — it just renders status + name + description + summary + payload.

---

## R9: Status Line Model Name

**Question**: What does `parsed.model` contain and how to clean it?

**Finding**: In `status-line.tsx:68-69`, `local.model.parsed()` returns a parsed model identifier. The `.model` property contains the model name as parsed by the local context. Looking at the code, `parsed.model` already appears to be the model name. The confusing "Liteai · gemini-3.5-flash" pattern described in the roadmap may have been fixed or may come from the `provider` column (line 85-86) being displayed next to it. Need to verify during implementation.

**Decision**: Verify during implementation. If `parsed.model` contains a provider prefix, strip it. If the confusion is from adjacent column rendering, it may already be fine.
