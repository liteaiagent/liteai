# Phase 3.1: Message Interaction Layer

> **Status**: ✅ Complete (2026-05-01)
> **Estimated Effort**: 3 days
> **Dependencies**: Phase 3.0 (token data for compact suggestions)
> **Scope**: Keyboard-driven message navigation, actions, thinking toggle, error recovery

---

## Goal

Enable users to interact with individual messages in the conversation — navigate to them, copy content, retry, expand/collapse tool outputs, and toggle thinking mode — using keyboard-driven navigation rather than hover.

---

## Current State

### What Exists

| Component | File | Status |
|-----------|------|--------|
| Message Actions Bar | [`message-actions-bar.tsx`](file:///d:/liteai/packages/cli/src/tui/components/message-actions-bar.tsx) | 51 lines. Renders action hints from a `MessageAction[]` array. No navigation logic. |
| MessageSelector Context | `keybindings/default-bindings.ts` | ✅ Context exists — `up/down/j/k`, `ctrl+up/down` for top/bottom, `enter` for select |
| Clipboard | [`use-clipboard.ts`](file:///d:/liteai/packages/cli/src/tui/hooks/use-clipboard.ts) | ✅ Done — `useClipboard().copy()` with OSC-52 + platform fallback |
| Virtual Message List | [`virtual-message-list.tsx`](file:///d:/liteai/packages/cli/src/tui/components/virtual-message-list.tsx) | ✅ Done — supports `selectedIndex`, `scrollToIndex`, `isItemClickable` |

### What's Missing

- Message cursor mode (enter/exit the message navigation overlay)
- Per-message action execution (copy, retry, expand)
- Thinking block toggle (global and per-message collapse)
- Error recovery actions on failed messages
- Visual indicator for selected message (background highlight)

---

## Implementation Plan

### 3.1.1 — Message Cursor Mode

> [!IMPORTANT]
> **Key Design Decision**: The original plan specified hover-based message actions. After comparing Claude Code and Gemini CLI, **keyboard-driven navigation is the correct TUI pattern**. Hover doesn't translate to terminal UIs.

**Activation**: `shift+↑` to enter cursor mode from the prompt input.
**Exit**: `escape` or `shift+↓` past the last message to return to prompt.

**State Machine**:
```
PROMPT_FOCUSED ──(shift+↑)──> MESSAGE_CURSOR
MESSAGE_CURSOR ──(escape)───> PROMPT_FOCUSED
MESSAGE_CURSOR ──(j/↓)─────> next message
MESSAGE_CURSOR ──(k/↑)─────> previous message
MESSAGE_CURSOR ──(shift+↓ past end)──> PROMPT_FOCUSED
```

**New file**: `packages/cli/src/tui/hooks/use-message-cursor.ts`

```typescript
export type MessageCursorState = {
  active: boolean
  selectedIndex: number | undefined
  enter: () => void
  exit: () => void
  moveUp: () => void
  moveDown: () => void
}
```

**Integration**: The `VirtualMessageList` already supports `selectedIndex` prop and `scrollToIndex` — cursor mode sets this from the hook.

**Reference Implementation**:
- **Claude Code**: [`messageActions.tsx`](file:///D:/claude-code/src/components/messageActions.tsx) (450 lines) — Uses `MessageActionsSelectedContext` for background highlighting. `shift+↑` enters, `j/k` navigates. `stays` flag on actions keeps cursor mode after toggling expand/collapse.

---

### 3.1.2 — Per-Message Actions

When cursor mode is active, context-sensitive actions are available based on message type:

| Message Type | Available Actions | Keys |
|-------------|-------------------|------|
| **User message** | Copy, Edit (re-send) | `c`, `e` |
| **Assistant message** | Copy (full text), Copy (code blocks only) | `c`, `shift+c` |
| **Assistant with tool calls** | Copy, Expand/Collapse tool output | `c`, `enter` |
| **Error message** | Copy, Retry, Show recovery hints | `c`, `r` |
| **System/compact** | Expand history | `enter` |

**Modify**: [`message-actions-bar.tsx`](file:///d:/liteai/packages/cli/src/tui/components/message-actions-bar.tsx)

Add keybinding execution to the existing action bar. Actions are filtered by message type dynamically.

**New file**: `packages/cli/src/tui/components/message-action-handlers.ts`

Contains the action execution logic (clipboard, retry, expand) — separated from rendering for testability.

**Reference Implementation**:
- **Claude Code**: `messageActions.tsx` — Actions registered with `filterForMessage()` determining availability. `handleAction()` dispatches copy/edit/expand.

> [!TIP]
> **From Claude**: The `stays` flag on expand/collapse actions is elegant — the user can toggle tool output visibility without leaving cursor mode. Adopt this.

---

### 3.1.3 — Thinking Block Toggle

**New file**: `packages/cli/src/tui/components/thinking-toggle.tsx`

Two-level thinking toggle:
1. **Global toggle** (`alt+t` in Chat context — already bound): Shows a confirmation dialog to enable/disable extended thinking for the session.
2. **Per-message collapse** (in cursor mode, `t` on assistant messages): Collapses/expands thinking blocks for that specific message.

**Reference Implementation**:
- **Claude Code**: [`ThinkingToggle.tsx`](file:///D:/claude-code/src/components/ThinkingToggle.tsx) (153 lines) — Modal select dialog (Enabled/Disabled). Mid-conversation warning. Not per-message — session-level toggle.

> [!NOTE]
> Claude's thinking toggle is session-level only. Per-message collapse is our own extension — useful for reviewing long conversations where only some thinking blocks are relevant.

---

### 3.1.4 — Error Recovery Actions

When cursor mode is active on an error message, display contextual recovery hints:

| Error Type | Recovery Hint |
|-----------|---------------|
| Context window full | "Run `/compact` to summarize conversation" |
| Rate limited | "Wait N seconds, or switch model with `/models`" |
| Network error | "Press `r` to retry" |
| Tool execution failure | "Press `r` to retry, or `c` to copy error" |
| Auth error | "Run `/connect` to reconfigure provider" |

These are rendered as dimmed text below the error message when it's selected in cursor mode.

---

### 3.1.5 — Selected Message Visual

**Modify**: [`virtual-message-list.tsx`](file:///d:/liteai/packages/cli/src/tui/components/virtual-message-list.tsx)

The component already supports `selectedIndex` — enhance VirtualItem to render a left-border gutter indicator (`▌`) when selected, using `theme.accent` color.

Additionally, the `MessageActionsBar` should appear anchored below the selected message (not in the footer).

---

## Verification

- [x] `shift+↑` from prompt enters cursor mode, `escape` exits
- [x] `j/k` or `↑/↓` navigate between messages
- [x] `c` copies message content to clipboard with toast confirmation
- [x] `enter` on tool-call messages toggles expand/collapse (stays in cursor mode)
- [x] `r` on error messages retries the request
- [x] `alt+t` opens thinking toggle dialog
- [x] Selected message has visual indicator (left gutter `▌`)
- [x] Action bar shows context-sensitive hints below selected message
- [x] Error messages show recovery hints when selected
