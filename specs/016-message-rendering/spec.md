# Feature Specification: Message Rendering & Error Resilience

**Feature Branch**: `016-message-rendering`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "Phase 6 of the TUI overhaul — full adoption of Gemini CLI's message rendering UI patterns to enhance UX. Replace LiteAI's custom tool rendering, toast, thinking, and error display with Gemini CLI's unified architecture. Cover all tool types including special tools (Question, Todo, Task, Plan). Fix critical message-area bugs. Focus is UX enhancement, not just code completion."

## Clarifications

### Session 2026-05-21

- Q: Should cancelled/aborted tool calls have a dedicated status indicator, or be mapped to the failure state? The spec defines 4 states but the edge cases mention a cancelled state. Gemini CLI uses 6 distinct states (Pending, Executing, Success, Confirming, Cancelled, Error) with a strikethrough on cancelled tool names. → A: Adopt Gemini's full 6-state model with LiteAI's icon set. Cancelled is semantically distinct from Error (user-initiated vs system failure). Confirming covers the tool permission/approval flow.
- Q: The spec uses two visually similar but distinct Unicode codepoints for error indicators: `✗` (U+2717 BALLOT X) in FR-006 and `✕` (U+2715 MULTIPLICATION X) in FR-013. Should these be standardized? → A: Standardize on `✗` (U+2717 BALLOT X) everywhere — both for tool failure indicators and error message prefixes. Single canonical character eliminates implementer ambiguity.
- Q: Should session errors go to toast or to the message history? Gemini CLI uses two channels: persistent `ErrorMessage` items in message history (with `✕` prefix) for session-level errors, and ephemeral inline `ToastDisplay` text for input-level feedback (Ctrl+C, Esc, queue errors) auto-dismissed at 3s. → A: Adopt Gemini's two-channel pattern. Session errors persist in message history with `✗` prefix. Toast is reserved for ephemeral input-level feedback only (3s auto-dismiss), rendered as inline text (Gemini-style) replacing the current bordered-box toast.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Error-Free Session Interaction (Priority: P1)

A developer starts a coding session and issues prompts that trigger tool calls (file reads, writes, shell commands, plan mode). The session completes without spurious error messages, without "undefined" messages appearing, and without unrelated system output (such as telemetry span errors) corrupting the terminal display.

**Why this priority**: Critical bugs currently prevent basic usability — sessions randomly show "X undefined" errors, `plan_enter` fails with a model resolution error, and OpenTelemetry errors leak into the TUI. These must be fixed before any visual improvements can be meaningfully tested.

**Independent Test**: Start a session, run a multi-step prompt that triggers plan mode and multiple tool calls, abort mid-stream with Esc, type "continue" and submit — verify no spurious error messages appear and input clears correctly.

**Acceptance Scenarios**:

1. **Given** a session is active and the user enters plan mode, **When** the plan subagent starts execution, **Then** the parent model is resolved correctly and no "Could not determine parent model" error appears.
2. **Given** a session encounters a server-side error, **When** the error event is received by the TUI, **Then** a readable error message is displayed as a persistent `ErrorMessage` in the message history (with `✗` prefix, not "X undefined") describing what went wrong.
3. **Given** a session is being streamed, **When** the user presses Esc to abort, **Then** no telemetry span errors leak into the terminal output and the TUI remains visually intact.
4. **Given** the user submits text during an error state, **When** the submit action completes, **Then** the input field is cleared regardless of the session's error status.

---

### User Story 2 - Unified Tool Call Rendering (Priority: P2)

A developer watches tool calls execute during a coding session. **Every** tool call — regardless of type — displays through a unified visual pattern adapted from Gemini CLI's `DenseToolMessage`: a status indicator column, a bold tool name column (fixed-width for alignment), and a muted description/result area. This applies to file tools, search tools, shell tools, and all special tools (Question, Todo, Task/Subagent, Skill, Patch).

**Why this priority**: The current tool rendering uses 9 different custom icons across 15 per-tool renderers (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `List`, `WebFetch`, `CodeSearch`, `WebSearch`, `Task`, `Question`, `Skill`, `CommandStatus`, `SendCommandInput`, `ApplyPatch`, `TodoWrite`, `GenericTool`) with no visual consistency. The internal `InlineTool` and `BlockTool` primitives use bordered boxes and custom per-tool icons (`→ ✱ $ ← ⚙ ◇ ◈ │ %`), creating cognitive overhead for users scanning tool output.

**Independent Test**: Trigger a prompt that invokes at least 5 different tool types (e.g., Read, Write, Shell, Grep, Question), observe that ALL tool calls use the same `[status indicator] [bold name] [muted description] → [result summary]` layout with aligned columns.

**Acceptance Scenarios**:

1. **Given** a tool call is pending (queued), **When** it is rendered in the message area, **Then** it displays a pending indicator (`○`), bold tool name, and optional description in a fixed-width columnar layout.
2. **Given** a tool call is executing, **When** it is rendered, **Then** it displays a spinner indicator, bold tool name, and description text — visually indistinguishable in layout from any other tool type.
3. **Given** a tool call completes successfully, **When** the result is rendered, **Then** the spinner is replaced with a success indicator (`✓`) and a result summary is shown (e.g., file path, match count, elapsed time).
4. **Given** a tool call is awaiting user confirmation (permission check), **When** it is rendered, **Then** it displays a confirming indicator (`?`) with the tool name and what's being confirmed — matching Gemini CLI's `ToolCallStatus.Confirming` pattern.
5. **Given** a tool call is cancelled by the user (Esc pressed, permission denied), **When** it is rendered, **Then** it displays a cancelled indicator (`–`) with a strikethrough on the tool name, visually distinct from the error state.
6. **Given** a tool call fails, **When** the error is rendered, **Then** an error indicator (`✗`) is shown with the error description in the error theme color.
7. **Given** a `Question` tool call completes, **When** it is rendered, **Then** it uses the same unified layout as any other tool — the Q&A content appears as the result summary/payload, not in a bordered box.
8. **Given** a `TodoWrite` tool call completes, **When** it is rendered, **Then** it uses the unified layout with checklist items shown as the result payload, matching Gemini CLI's approach of rendering todos within the `DenseToolMessage` pattern via `isTodoList()`.
9. **Given** a `Task` (subagent) tool call is executing, **When** it is rendered, **Then** it uses the unified layout with spinner and subagent activity description, not a custom bordered component.
10. **Given** a file-modifying tool (Write, Edit, ApplyPatch) completes, **When** it is rendered, **Then** the diff/content is shown as an expandable payload beneath the unified tool line (matching Gemini's `DenseToolMessage` diff rendering pattern).
11. **Given** multiple tool calls are collapsed into a group, **When** the group is rendered, **Then** it shows grouped status indicators and a summary count (e.g., "3 tools ✓✓✓") rather than raw text like "Ran 3 read, 2 grep."

---

### User Story 3 - Thinking Block Display (Priority: P3)

A developer sees the model's thinking/reasoning process rendered as a visually distinct left-bordered block. When collapsed, it shows a right-pointing arrow with token count. When expanded, it shows the thinking content indented with a vertical border line.

**Why this priority**: The current thinking display has a wrong collapse indicator (`▼` instead of `▶`) and lacks visual distinction from regular message content. This is a polish item that improves readability but doesn't block core functionality.

**Independent Test**: Trigger a prompt that produces reasoning/thinking output, verify the collapsed state shows `▶ Thinking (N tokens)` and the expanded state shows a left-bordered indented block.

**Acceptance Scenarios**:

1. **Given** a thinking block is collapsed, **When** it is rendered, **Then** it displays `▶ Thinking (N tokens)` with the right-pointing triangle.
2. **Given** a thinking block is expanded, **When** it is rendered, **Then** it displays with a left vertical border, the subject line in bold, and body text in a muted/secondary color.
3. **Given** multiple thinking blocks appear across message boundaries, **When** they are rendered, **Then** no duplicate thinking blocks are shown (the deduplication filter works correctly across boundaries).

---

### User Story 4 - Ephemeral Toast & Persistent Error Display (Priority: P3)

A developer sees two distinct notification channels: (1) **ephemeral toast** in the prompt footer area for input-level feedback (e.g., "Press Esc again to clear", "Press Ctrl+C again to exit", queue errors) — rendered as simple colored inline text without bordered boxes, auto-dismissed after 3 seconds; and (2) **persistent error/warning messages** in the message history for session-level issues (e.g., model failures, plan errors) — rendered with a `✗` or `⚠` prefix and preserved in the conversation scrollback.

**Why this priority**: The current bordered-box toast rendering is visually heavy, breaks the clean TUI aesthetic, and conflates ephemeral input feedback with persistent session errors. Separating the two channels (matching Gemini CLI's pattern) improves information hierarchy — users can scroll back to see past errors instead of losing them to auto-dismiss.

**Independent Test**: (a) Press Esc once during input — verify an inline text toast appears in the footer (no boxes) and auto-dismisses after 3 seconds. (b) Trigger a session error — verify an `ErrorMessage` with `✗` prefix appears in the message history and persists when scrolling back.

**Acceptance Scenarios**:

1. **Given** the user presses Esc or Ctrl+C once, **When** the toast feedback is displayed, **Then** it appears as inline colored text in the prompt footer — no bordered boxes, no overlays.
2. **Given** an ephemeral toast is visible, **When** its 3-second auto-dismiss timer expires, **Then** it disappears without visual artifacts.
3. **Given** a session-level error occurs (model failure, plan error, etc.), **When** the error is received by the TUI, **Then** it is rendered as a persistent `ErrorMessage` in the message history with a `✗` prefix in the error theme color.
4. **Given** a session-level warning occurs, **When** the warning is received by the TUI, **Then** it is rendered as a persistent `WarningMessage` in the message history with a `⚠` prefix in the warning theme color.
5. **Given** multiple ephemeral notifications occur in rapid succession, **When** they are displayed, **Then** the most recent notification replaces the previous one in the toast area (not stacked).

---

### User Story 5 - Clean Status Line (Priority: P3)

A developer sees the status line at the bottom of the TUI showing only the model display name (e.g., "gemini-3.5-flash") without redundant agent/provider prefixes and without error text leaking into the status columns.

**Why this priority**: Minor UX polish — the current status line shows confusing text like "Liteai · gemini-3.5-flash" which is redundant, and error messages can leak into column values.

**Independent Test**: Start a session, check the status line shows only the model name. Trigger an error, verify no error text appears in the status line columns.

**Acceptance Scenarios**:

1. **Given** a session is active, **When** the status line is rendered, **Then** the model column shows only the model display name without agent/provider prefix.
2. **Given** an error has occurred in the session, **When** the status line is rendered, **Then** no error text leaks into the status line columns; errors are displayed only in their designated areas (message history for persistent errors, footer for ephemeral toast).

---

### User Story 6 - Special Tool UX Consistency (Priority: P2)

A developer uses tools that require interactive or complex displays — asking questions (`ask_user`), tracking todos (`todowrite`), delegating to subagents (`task`), entering plan mode, and running shell commands (`run_command`). Each of these tools renders through the unified visual system while preserving their unique interactive behaviors.

**Why this priority**: Special tools currently use inconsistent rendering — `Question` uses a bordered `BlockTool`, `TodoWrite` returns `null` (hidden!), `Task` shows an `InlineTool` with a `│` icon, and `plan_enter`/`plan_exit` fall through to `GenericTool`. This creates a fragmented UX where some tools look polished and others feel broken. Full Gemini CLI adoption means these tools must integrate into the unified pattern.

**Independent Test**: (a) Trigger a prompt that uses `ask_user` — verify the question renders with unified layout and the Q&A result is visible after answering. (b) Use a prompt that creates todos — verify they render inline (not hidden). (c) Use plan mode — verify plan entry/exit shows clean status feedback.

**Acceptance Scenarios**:

1. **Given** the model invokes `ask_user` to ask a question, **When** the question is pending user response, **Then** the tool shows a confirming indicator (`?`) with the question text visible, not hidden behind a bordered box.
2. **Given** the user answers a question from `ask_user`, **When** the completed result is rendered, **Then** the tool description is hidden (Gemini's `isCompletedAskUserTool` pattern) and the answer is the visible result — the user sees what they answered, not what was asked.
3. **Given** the model writes todos via `todowrite`, **When** the todos are rendered, **Then** they appear as a checklist payload beneath the unified tool line — not hidden (current behavior returns `null`), not in a bordered block.
4. **Given** a `task` (subagent) delegation is in progress, **When** it is rendered, **Then** the tool shows a spinner with the delegation description and the number of sub-toolcalls, matching the subagent activity pattern.
5. **Given** the user enters plan mode, **When** the `plan_enter` tool is rendered, **Then** it uses the unified layout with a clear description (not `GenericTool` fallback with raw JSON input).
6. **Given** a shell command (`run_command`) is executing, **When** it is rendered, **Then** it retains its specialized shell output view (scrollable output, exit code, duration) because shell output has unique sub-view requirements — but the header row still uses the unified status indicator pattern.

---

### Edge Cases

- What happens when a tool call is aborted mid-execution (Esc pressed)? → The tool should show a dedicated cancelled indicator (distinct from error) with a strikethrough on the tool name, not remain in a spinning state.
- What happens when the error message string is empty or null? → The persistent `ErrorMessage` in the message history should display a sensible fallback message (e.g., "Session encountered an error").
- What happens when a thinking block has zero tokens? → The collapsed view should show `▶ Thinking (0 tokens)` or omit the token count.
- What happens when the model name returned by the provider is empty? → The status line should show a fallback like "unknown" rather than an empty column.
- What happens when tool calls complete faster than the render cycle? → The spinner should never appear; the tool should render directly in its completed state.
- What happens when an `ask_user` question is dismissed/rejected? → The tool should show a cancelled indicator with strikethrough, matching the cancelled state.
- What happens when `todowrite` has zero items? → The tool should render the unified line with a "No todos" summary, not return `null`.
- What happens when the user's permission confirmation times out? → The tool should transition from Confirming to Cancelled, not remain in the confirming state indefinitely.
- What happens when a subagent (`task`) fails with an error? → The unified tool line should show the error indicator (`✗`) and the failure reason as the result summary, not hide behind a generic message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST resolve the parent model for plan subagents from the execution context (not from in-flight message lookups) to prevent "Could not determine parent model" errors.
- **FR-002**: System MUST extract error messages from the correct shape of the error event (`error.message`, not `error.data.message`) when displaying session errors in the message history.
- **FR-003**: System MUST suppress telemetry span errors during session abort by guarding span operations against already-ended spans.
- **FR-004**: System MUST clear the input field after submission regardless of the current session error state.
- **FR-005**: System MUST render ALL tool calls — including file tools, search tools, shell tools, and special tools (Question, Todo, Task, Plan, Skill, Patch, CommandStatus, SendCommandInput) — using a unified visual pattern adapted from Gemini CLI's `DenseToolMessage`: `[status indicator column] [bold tool name column, fixed-width max 25ch] [muted description] → [result summary]`. No tool type renders with a per-tool custom icon.
- **FR-006**: System MUST use a consistent set of six status indicators across all tools: `○` (pending), spinner (executing), `✓` (success), `?` (confirming/awaiting approval), `–` (cancelled, with strikethrough on tool name), `✗` (error). Cancelled (user-initiated abort) is semantically distinct from Error (system failure).
- **FR-007**: System MUST render thinking blocks with a left vertical border when expanded and a `▶` right-pointing triangle when collapsed.
- **FR-008**: System MUST deduplicate thinking blocks across message boundaries to prevent duplicate rendering.
- **FR-009**: System MUST render ephemeral toast notifications (input-level feedback: Esc hints, Ctrl+C warnings, queue errors) as inline colored text in the prompt footer area without borders, boxes, or overlays, auto-dismissed after 3 seconds. Session-level errors and warnings MUST NOT use toast — they are rendered as persistent entries in the message history (see FR-013).
- **FR-010**: System MUST display only the model display name in the status line model column, without agent or provider prefixes.
- **FR-011**: System MUST prevent error text from leaking into status line column values.
- **FR-012**: System MUST display collapsed tool groups with grouped status indicators and a summary count, matching Gemini CLI's `ToolGroupDisplay` pattern.
- **FR-013**: System MUST render session-level error messages as persistent entries in the message history with a `✗` prefix and error theme color, and warning messages with a `⚠` prefix and warning theme color. These are distinct from ephemeral toast (FR-009). The `✗` character is the same U+2717 BALLOT X used for tool error status (FR-006) to maintain visual consistency.
- **FR-014**: System MUST eliminate the `BlockTool` bordered-box rendering pattern for all tool types. File diffs, Q&A results, todo lists, and other rich content MUST render as expandable payloads beneath the unified tool line (matching Gemini's `DenseToolMessage` payload pattern), not inside bordered boxes.
- **FR-015**: System MUST render completed `ask_user` (Question) tools by hiding the description text and showing only the answer as the result — matching Gemini CLI's `isCompletedAskUserTool` pattern where the result display speaks for itself.
- **FR-016**: System MUST render `todowrite` tools with a visible checklist payload (matching Gemini's `isTodoList()` handling in `DenseToolMessage`), not return `null` as the current implementation does.
- **FR-017**: System MUST render `plan_enter` and `plan_exit` tools through the unified layout with a clear human-readable description (e.g., "Entering plan mode", "Exiting plan mode"), not fall through to `GenericTool` with raw JSON input.
- **FR-018**: System MUST render `run_command` (shell) tools with the unified status indicator in the header row, while preserving the specialized shell output sub-view (scrollable output, exit code, duration) as the payload — matching Gemini CLI's `ShellToolMessage` pattern where the shell is the only tool with a dedicated sub-view.
- **FR-019**: The CLI layer MUST map the core's 4-state tool status (`pending`, `running`, `completed`, `error`) to the display's 6-state model (Pending, Executing, Success, Confirming, Cancelled, Error) using a display-side mapping function — similar to Gemini CLI's `mapCoreStatusToDisplayStatus`. The `Confirming` state is derived from the existing permission request flow. The `Cancelled` state is derived from tools whose errors indicate user rejection (permission denied, user dismissed).
- **FR-020**: System MUST render tool result summaries using the `→` arrow separator pattern (e.g., `→ Accepted (+12, -3)`, `→ 5 matches`, `→ Read 3 files`) matching Gemini CLI's result display convention for visual consistency.

### Key Entities

- **ToolStatusIndicator**: A visual component representing the current state of a tool call across six display states: Pending, Executing, Success, Confirming, Cancelled, Error. Each state has a distinct indicator icon and color. Cancelled tools additionally render with a strikethrough on the tool name.
- **DenseToolMessage**: The unified rendering pattern for all tool calls, adapted from Gemini CLI. Combines a status indicator, tool name (bold, fixed-width column), description (muted), and result summary in a single-line layout. Rich content (diffs, Q&A, todos, shell output) renders as an expandable payload beneath the tool line.
- **ShellToolMessage**: A specialized variant of the unified tool pattern for `run_command` tools. Uses the same status indicator header row, but provides a dedicated sub-view for scrollable shell output, exit codes, and duration. This is the ONLY tool type that retains a specialized content view.
- **Toast Notification**: An ephemeral inline text message displayed in the prompt footer area for input-level feedback only (Esc, Ctrl+C, queue errors). Auto-dismissed after 3 seconds. NOT used for session-level errors or warnings.
- **ErrorMessage**: A persistent message rendered in the conversation history with a `✗` prefix for session-level errors (model failures, plan errors, etc.).
- **WarningMessage**: A persistent message rendered in the conversation history with a `⚠` prefix for session-level warnings (context window limits, etc.).
- **Thinking Block**: A collapsible display of the model's reasoning process, rendered with a left border when expanded.
- **DisplayStatusMapper**: A function that maps the core engine's 4-state tool status to the display layer's 6-state model, supplemented by permission request state and error message classification (permission denied → Cancelled, not Error).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero occurrences of "X undefined" or "Could not determine parent model" errors during a 10-prompt session that includes plan mode and tool calls.
- **SC-002**: All tool calls (across all 17 tool types) render with the same `[status] [name] [description] → [result]` visual pattern — zero tool-specific custom icons remain, zero bordered `BlockTool` boxes remain.
- **SC-003**: Users can distinguish tool call states (pending, executing, success, confirming, cancelled, error) at a glance within 1 second of visual scanning. All six states are visually distinct.
- **SC-004**: Ephemeral toast notifications render as inline text without any bordered boxes — visual footprint reduced to a single line of text. Session errors appear as persistent entries in the message history with `✗` prefix.
- **SC-005**: No telemetry or system error text appears in the user-facing TUI during normal operation, including abort scenarios.
- **SC-006**: The status line model column shows only the model name (e.g., "gemini-3.5-flash") without any prefixed text.
- **SC-007**: The input field clears immediately after submission in all states (normal, error, streaming, idle).
- **SC-008**: Special tools render with recognizable, useful output: `Question` shows answers, `TodoWrite` shows checklist items (not hidden), `Task` shows subagent activity, `plan_enter`/`plan_exit` show clean mode descriptions.
- **SC-009**: The visual output of a 10-prompt session matches the quality standard of Gemini CLI's TUI — no visual regression from the reference implementation's density, alignment, and information hierarchy.

## Assumptions

- Phases 1–5 of the TUI overhaul are complete, providing stable dialog primitives, focus management, visual design system, and polish foundations.
- The existing theme system in `@liteai/cli` provides the color tokens needed for error, warning, success, and muted text states.
- The core engine's `ToolState` type provides 4 states (`pending`, `running`, `completed`, `error`). The 6-state display model is handled entirely in the CLI layer — no core schema changes are required. The `confirming` display state is derived from the existing permission request flow (checking if a permission is pending for the tool's `callID`). The `cancelled` display state is derived from error messages indicating user rejection.
- The `RunCommand` tool retains a specialized shell output sub-view (the ONLY exception to the unified pattern) because scrollable shell output, exit codes, and interactive shell focus are fundamentally different from other tool outputs.
- The Gemini CLI source files (Apache 2.0 licensed) are available locally at `D:\gemini-cli` as the structural reference for pattern adaptation.
- The error event shape from the core session engine is `{ name?: string; message?: string }` (flat structure, no `data` wrapper).
- The `todowrite` tool currently returns `null` in the UI — this is a known bug that will be fixed as part of this feature.
