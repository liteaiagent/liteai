# Phase 6: Message Rendering & Error Resilience

> **Status**: Planned  
> **Scope**: `@liteai/cli` — Message area, tool rendering, error handling, toast  
> **Reference**: [Gemini CLI](D:\gemini-cli\packages\cli\src\ui\components\messages) (Apache 2.0)  
> **Approach**: In-place modification of `@liteai/cli` — LiteAI visual identity  
> **Predecessor**: Phases 1–5 (✅ Done — dialog primitives, focus, visual design, polish)

---

## Problem Statement

The message rendering area has systemic issues that compound during error states:

| Issue | Severity | Root Cause |
|-------|----------|------------|
| `plan_enter` fails ("Could not determine parent model") | **Critical** | `ctx.messageID` lookup on in-flight message |
| "X undefined" toast on session error | **Critical** | Error shape mismatch in `onSessionError` |
| OpenTelemetry span error leaks to stdout | **High** | `span.end()` double-call on abort, no stderr suppression |
| `continue` text remains in input after submit | **High** | Input not clearing on submit during error state |
| Duplicate thinking blocks rendered | **Medium** | `lastReasoningId` filter not working across message boundaries |
| Collapsed thinking shows `▼` (should be `▶`) | **Low** | Wrong Unicode character |
| Tool icons visually inconsistent (`→ ✱ $ ← ⚙ ◇`) | **Medium** | Per-tool custom icons, no unified status pattern |
| Status line shows raw error text ("span once") | **High** | Console output leaking to TUI rendering |
| Agent·model footer is confusing UX | **Medium** | Redundant provider+agent prefix in model column |

---

## Design: Gemini CLI Patterns → LiteAI Identity

We adopt Gemini CLI's **structural patterns** but use LiteAI's own visual design language.

### Tool Rendering: Unified `InlineTool`

**Gemini pattern** (`DenseToolMessage`):
```
  ✓ edit_file   src/foo.ts → Accepted (+12, -3)
  ⊷ shell       npm install → (running)
  x write_file  error.ts → Permission denied
```

**LiteAI adaptation** (preserving our theme system):
```
  ✓ Write  index.html (49s)
  ✓ Read   src/foo.ts (0.2s)
  ⠋ Shell  running command... (1.2s)
  ✗ Plan   Error: Could not determine parent model
```

Key structural changes:
- **Unified status indicator** (`✓` / `✗` / spinner / `⏳`) replaces 9 custom icons
- **Fixed-width status column** (`minWidth=3`) for visual alignment
- **Bold tool name** after indicator, muted description after
- Per-tool renderers (`Read`, `Write`, `Grep`, etc.) become **formatters** feeding the unified component

### Thinking Display: Left-Bordered Block

**Current** (broken): `▼ Thinking: **title** (195 tokens)` — uses wrong collapse indicator

**Adapted from Gemini**:
```
  Thinking...
  │ Planning the file structure
  │ Considering test coverage requirements
```

When collapsed:
```
  ▶ Thinking (195 tokens)
```

### Toast: Inline Text (No Borders)

**Current** (broken): Red bordered `<Box borderStyle="round">` showing "X undefined"

**Adapted from Gemini**: Simple colored text rendered inline in the prompt footer:
```
  Session encountered an error — type /retry or press esc
```

No borders. No boxes. No overlay. Just colored text that auto-dismisses.

### Error Messages: Prefix Pattern

**Adapted from Gemini**:
```
  ✕ Could not determine parent model for plan subagent
  ⚠ Context window is 85% full — consider /compact
```

LiteAI already has `ErrorRecoveryHint` in `message.tsx` which is good — we keep that and enhance it with the prefix pattern.

---

## Execution Plan

### Step 1: Critical Bug Fixes (Prerequisites)

These must be fixed BEFORE any rendering changes to have a stable testing baseline.

#### 1a. Fix `plan_enter` model resolution
- **File**: `packages/core/src/tool/plan.ts` (lines 219-233)
- **Fix**: Use `ctx.extra.model` instead of `ctx.messages.findLast()` for parent model
- **Test**: New `test/plan-mode/plan-enter-model-resolution.test.ts`

#### 1b. Fix `onSessionError` undefined toast
- **File**: `packages/cli/src/tui/state/app-state-context.tsx` (line 143)
- **Bug**: Extracts `err?.data?.message` but error shape is `{ name?, message? }` (no `data` wrapper)
- **Fix**: `const message = err?.message ?? "Session encountered an error"`

#### 1c. Suppress OpenTelemetry span errors
- **File**: `packages/core/src/session/llm.ts` (line 360, `flush()` in TransformStream)
- **Fix**: Wrap `span.setAttribute()` calls in try/catch — the span may already be ended on abort
- **File**: CLI entry point — redirect stderr to log file to prevent TUI corruption

#### 1d. Fix input not clearing after submit during error state
- **File**: Likely in `packages/cli/src/tui/components/prompt/prompt-input.tsx` submit handler
- **Fix**: Ensure input clear happens regardless of session status

### Step 2: Foundation Components

#### 2a. `ToolStatusIndicator` component
- **New file**: `packages/cli/src/tui/components/tool-status-indicator.tsx`
- Port Gemini's `ToolStatusIndicator` from `ToolShared.tsx`
- Adapt to LiteAI theme system and `ToolPart.state.status` enum
- Replace `tool-use-loader.tsx`

#### 2b. `ErrorMessage` and `WarningMessage` components
- **New files**: `packages/cli/src/tui/components/error-message.tsx`, `warning-message.tsx`
- Port Gemini's prefix pattern: `✕ ` (error) / `⚠ ` (warning)
- Use LiteAI `theme.error` / `theme.warning` colors

#### 2c. Toast → Inline Notification
- **Modify**: `packages/cli/src/tui/context/toast.tsx`
- **Modify**: `packages/cli/src/tui/ui/toast.tsx`
- Remove bordered box rendering, replace with inline `<Text>` in footer area
- Keep the context API (show/dismiss) but change rendering to match Gemini's pattern

### Step 3: Tool Rendering Overhaul

#### 3a. Unified `InlineTool` component
- **Modify**: `packages/cli/src/tui/routes/session/tools.tsx`
- Create a single `InlineTool` that uses `ToolStatusIndicator` + bold name + muted description
- Per-tool components (`Read`, `Write`, `Grep`, etc.) become **description formatters** — functions that return `{ name, description, detail }` instead of full React components
- Keep `RunCommand` as a separate component (has shell output sub-view)

#### 3b. Collapsed Group View
- **Modify**: `packages/cli/src/tui/components/collapsed-group-view.tsx`
- Replace `▶ Ran 3 read, 2 grep` with grouped tool status indicators
- Port Gemini's `ToolGroupDisplay` pattern

### Step 4: Thinking & Message Polish

#### 4a. Fix thinking display
- **Modify**: `packages/cli/src/tui/routes/session/parts.tsx`
- Collapsed: `▶ Thinking (195 tokens)` — fix `▼` to `▶`
- Expanded: Left-bordered block with subject line bold, body text muted
- Port Gemini's `ThinkingMessage` structure

#### 4b. Fix status line
- **Modify**: `packages/cli/src/tui/components/status-line.tsx`
- Remove agent branding from model column (show only model name)
- Prevent error text from leaking into column values

#### 4c. Fix message error display
- **Modify**: `packages/cli/src/tui/routes/session/message.tsx`
- Ensure `message.error.data.message` displays correctly (not "Session failed" as default)
- Keep existing `ErrorRecoveryHint` — it's already good

---

## Files Changed (Summary)

### Core Package
| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/tool/plan.ts` | Modify | Fix model resolution |
| `packages/core/src/session/llm.ts` | Modify | Guard span.end() on abort |
| `packages/core/test/plan-mode/plan-enter-model-resolution.test.ts` | New | Test coverage |

### CLI Package — New Components
| File | Action | Purpose |
|------|--------|---------|
| `packages/cli/src/tui/components/tool-status-indicator.tsx` | New | Unified ✓/✗/⊷ indicator |
| `packages/cli/src/tui/components/error-message.tsx` | New | `✕ ` prefix error display |
| `packages/cli/src/tui/components/warning-message.tsx` | New | `⚠ ` prefix warning display |

### CLI Package — Modified Components
| File | Action | Purpose |
|------|--------|---------|
| `packages/cli/src/tui/routes/session/tools.tsx` | Major rewrite | Unified InlineTool |
| `packages/cli/src/tui/routes/session/parts.tsx` | Modify | Thinking display fix |
| `packages/cli/src/tui/routes/session/message.tsx` | Modify | Error display fix |
| `packages/cli/src/tui/components/collapsed-group-view.tsx` | Modify | Group display improvement |
| `packages/cli/src/tui/components/status-line.tsx` | Modify | Model column, error leak |
| `packages/cli/src/tui/components/tool-use-loader.tsx` | Delete | Replaced by tool-status-indicator |
| `packages/cli/src/tui/context/toast.tsx` | Modify | Remove box, inline text |
| `packages/cli/src/tui/ui/toast.tsx` | Modify | Inline rendering |
| `packages/cli/src/tui/state/app-state-context.tsx` | Modify | Fix error shape extraction |

---

## Verification Plan

### Automated
1. `bun test test/plan-mode` — plan_enter model resolution
2. `bun typecheck` — no type regressions  
3. `bun lint:fix` — formatting compliance

### Manual (Scenario-based)
1. "create a snake game" → verify tool calls render with unified indicators
2. Press Esc mid-stream → verify toast shows inline text (not "X undefined")
3. Esc → type "continue" → Enter → verify input clears and no error on screen
4. Long output → verify scroll works in both compact and transcript modes
5. Check status line shows clean model name, no error text leaking

---

## Dependencies

- Phase 5 (✅ Done) — dialog/focus primitives are prerequisite
- No external dependencies — all changes within `@liteai/cli` and `@liteai/core`

---

## Reference: Gemini CLI Source Files to Port From

These are the specific Gemini CLI files (Apache 2.0) whose **patterns** we adapt into LiteAI's visual identity.

### Tool Rendering
- `D:\gemini-cli\packages\cli\src\ui\components\messages\ToolShared.tsx` — `ToolStatusIndicator` component (lines 143-188), status icons: `✓ o ⊷ ? - x`
- `D:\gemini-cli\packages\cli\src\ui\components\messages\DenseToolMessage.tsx` — unified tool message component (475 LOC), layout: `[status] [name bold] [description] → [result]`
- `D:\gemini-cli\packages\cli\src\ui\components\messages\ToolGroupDisplay.tsx` — collapsed tool group display
- `D:\gemini-cli\packages\cli\src\ui\constants.ts` — `TOOL_STATUS` icon constants (line 20-27)

### Thinking Display
- `D:\gemini-cli\packages\cli\src\ui\components\messages\ThinkingMessage.tsx` — left-bordered block (98 LOC), uses `borderLeft={true}` with subject line bold + body italic

### Toast / Notifications
- `D:\gemini-cli\packages\cli\src\ui\components\ToastDisplay.tsx` — inline text (no borders), renders colored `<Text>` based on state flags
- `D:\gemini-cli\packages\cli\src\ui\components\Composer.tsx` — toast placement: renders `<ToastDisplay />` inside a `<Box minHeight={1}>` in the composer area (line 112-116)

### Error / Warning Messages
- `D:\gemini-cli\packages\cli\src\ui\components\messages\ErrorMessage.tsx` — `✕ ` prefix, red text, `marginBottom={1}` (32 LOC)
- `D:\gemini-cli\packages\cli\src\ui\components\messages\WarningMessage.tsx` — `⚠ ` prefix, uses `RenderInline` for markdown in warnings (33 LOC)

---

## Reference: Exact Bug Locations in LiteAI

### Bug 1: plan_enter model resolution (Critical)
- **File**: `D:\liteai\packages\core\src\tool\plan.ts`, lines 219-233
- **Code**: `ctx.messages.findLast((m) => m.info.id === ctx.messageID)` — looks up current message ID in the message list, but the message is still in-flight (not yet committed to the list)
- **Fix**: Use `ctx.extra.model` which is populated by the session engine with the current model

### Bug 2: "X undefined" toast (Critical)
- **File**: `D:\liteai\packages\cli\src\tui\state\app-state-context.tsx`, lines 141-148
- **Code**: `const message = err?.data?.message ?? "Session encountered an error"` — extracts `err.data.message`
- **Event shape** (line 179 of `app-state-events.ts`): `const error = event.properties.error as { name?: string; message?: string }` — error has `message` directly, NOT nested under `data`
- **Fix**: Change to `err?.message ?? "Session encountered an error"`

### Bug 3: OpenTelemetry span leak (High)
- **File**: `D:\liteai\packages\core\src\session\llm.ts`, line 360 (`flush()` in TransformStream)
- **Root cause**: When session is aborted, the `span` captured at line 327 may already be ended by the AI SDK's internal cleanup. The `flush()` then calls `span.setAttribute()` on a dead span, which OpenTelemetry logs to stderr/stdout
- **Fix**: Wrap span operations in try/catch in the `flush()` function

### Bug 4: Thinking collapse arrow
- **File**: `D:\liteai\packages\cli\src\tui\routes\session\parts.tsx`, line 76
- **Code**: `▼ Thinking{displayTitle} ({formattedTokens} tokens)` — `▼` means expanded, should be `▶` for collapsed
- Line 96 already correctly uses `▼` for the expanded state

### Bug 5: Status line model column
- **File**: `D:\liteai\packages\cli\src\tui\components\status-line.tsx`, lines 68-82
- **Issue**: `modelText = parsed.model` includes provider-prefixed name showing as "Liteai · gemini-3.5-flash"
- **Fix**: Show only the model display name, no agent prefix

### Bug 6: Toast rendering with borders
- **File**: `D:\liteai\packages\cli\src\tui\ui\toast.tsx` — uses `<Box borderStyle="round">` for each toast entry
- **File**: `D:\liteai\packages\cli\src\tui\context\toast.tsx` — context API (keep `show`/`error`/`toasts` interface, change rendering)

---

## Reference: Key LiteAI Files (Context for New Session)

### Message rendering pipeline
```
SessionRoute (routes/session/index.tsx)
  └─ SessionLayout (components/session-layout.tsx) — scroll, focus
      └─ Messages (routes/session/messages.tsx) — virtual list
          └─ MessageRow (routes/session/message-row.tsx) — role dispatch
              ├─ UserMessageContent (routes/session/message.tsx)
              └─ AssistantMessageContent (routes/session/message.tsx)
                  ├─ TextPartView (routes/session/parts.tsx)
                  ├─ ReasoningPartView (routes/session/parts.tsx) — thinking
                  ├─ ToolPartView (routes/session/parts.tsx) — tool dispatch
                  │   └─ Read/Write/Grep/... (routes/session/tools.tsx) — 15 renderers
                  ├─ CollapsedGroupView (components/collapsed-group-view.tsx)
                  └─ ErrorRecoveryHint (routes/session/message.tsx) — already good
```

### Error event flow
```
Core: session engine → bus.publish("session.error")
  └─ SSE → event.properties = { sessionID, error: { name, message } }
      └─ CLI: handleAppStateEvent (state/app-state-events.ts:177)
          ├─ setState: mark last assistant message with error, set status idle
          └─ onSessionError (state/app-state-context.tsx:141)
              └─ toastShow({ variant: "error", message: ??? }) ← BUG: wrong shape
```

### State management
- **Store**: Zustand-like `AppStore` in `state/app-store.ts`
- **Events**: SSE events processed by `handleAppStateEvent` in `state/app-state-events.ts`
- **Provider tree**: 14 context providers wrapping the entire TUI

### Conversation reference
- Research conversation: `170a81dc-9f86-44a5-be5a-a00f2aaee2f7`
- Logs: `C:\Users\ahmed\.gemini\antigravity-ide\brain\170a81dc-9f86-44a5-be5a-a00f2aaee2f7\.system_generated\logs\transcript.jsonl`
