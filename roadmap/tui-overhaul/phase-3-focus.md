# Phase 3: Focus & Navigation Architecture

> **Status**: ✅ Completed — 2026-05-16  
> **Depends On**: Phase 2 (Component Migration)  
> **Estimated Effort**: Medium (~3-5 days) — completed in 1 session
>
> **Design Session**: 2026-05-16 — unified component path architecture finalized

### Delivered
- `modal-pane.tsx` — `replaceTop` (atomic stack swap, no flicker)
- `use-navigation.ts` — `replace` wired to `replaceTop`
- `routes/session/ctx.tsx` — `sessionID: string | undefined`, `useOptionalSessionContext()`
- `state/app-state-selectors.ts` — 5 selectors widened to `string | undefined`
- `components/prompt/prompt-input.tsx` — `focus: boolean` required prop, internal modal check removed
- `components/status-line.tsx` — unified boot + active, onboarding hint, session ID segment removed
- `routes/session/index.tsx` — focus arbiter, Logo+Tips empty state, sync/cleanup guard
- `app.tsx` — `BlankSession` + `BlankSessionContent` deleted (~120 lines), single `SessionRoute` path
- `components/exit-summary.ts` — UTF-8/ASCII detected Gemini-style exit summary

---

## Agent Context

Load these files before starting implementation.

### Roadmap Docs
- `d:\liteai\roadmap\tui-overhaul\phase-3-focus.md` — this file (focus arbiter, modal stack, BlankSession elimination)
- `d:\liteai\roadmap\tui-overhaul\design\decisions.md` — Decision 3 (hybrid modal), Decision 8 (single path), Decision 9 (provider minimalism)

### LiteAI Source (modification targets)
- `d:\liteai\packages\cli\src\tui\app.tsx` — `BlankSession` + `BlankSessionContent` to eliminate, `AppContent` to update
- `d:\liteai\packages\cli\src\tui\context\modal-pane.tsx` — upgrade from single-slot to stack-based
- `d:\liteai\packages\cli\src\tui\hooks\use-navigation.ts` — wire to push/pop/replaceTop
- `d:\liteai\packages\cli\src\tui\routes\session\index.tsx` — `SessionRoute` to accept `sessionID: string | undefined`
- `d:\liteai\packages\cli\src\tui\components\prompt\prompt-input.tsx` — accept `focus` prop
- `d:\liteai\packages\cli\src\tui\components\session-layout.tsx` — verify modal rendering from stack
- `d:\liteai\packages\cli\src\tui\context\session.tsx` — `SessionProvider` (already handles undefined sessionID)

### Gemini CLI Reference (dialog state management pattern)
- `D:\gemini-cli\packages\cli\src\ui\AppContainer.tsx` — how hook-per-dialog + boolean flags manage focus
- `D:\gemini-cli\packages\cli\src\ui\components\DialogManager.tsx` — dialog rendering orchestration
- `D:\gemini-cli\packages\cli\src\ui\components\Composer.tsx` — how composer unmounts during dialogs

### Claude Code Reference (structural focus exclusion)
- `D:\claude-code\src\screens\REPL.tsx` — `commandJsx` slot replacing prompt, single owner
- `D:\claude-code\src\components\FullscreenLayout.tsx` — modal slot + overlay architecture
- `D:\claude-code\src\keybindings\useKeybinding.ts` — context-based keybinding registration


## Goal

Centralize focus management so that input conflicts are impossible by construction. Implement modal stack push/pop semantics for proper nested dialog escape chains. Eliminate the `BlankSession` / `SessionRoute` split so that a single rendering path handles both boot and active states.

---

## Design Principle: Unified Component Path

> **Decided 2026-05-16**: ONE `SessionRoute` as the structural entry point. Data-driven conditionals (empty vs non-empty messages) replace structural branches (BlankSession vs SessionRoute). Some conditional rendering remains by design (tab wrapping, Logo vs Messages) but the layout infrastructure is identical in all states.

The "boot state" is simply `SessionRoute` where `sessionID` is `undefined` and `messages.length === 0`. Data-level guards, not component-level branches.

```
AppContent
  └─ ModalPaneProvider
       └─ SessionRoute(sessionID: string | undefined)
            ├─ StatsProvider
            ├─ SessionProvider (sessionID can be undefined)
            ├─ SessionLayout
            │    ├─ scrollable: Messages (renders Logo+Tips when empty)
            │    ├─ bottom: SessionBottom
            │    │    ├─ PromptInput (focus prop)
            │    │    └─ StatusLine (unified — session-dependent segments skip when undefined)
            │    └─ overlay: Permissions / Questions
            └─ ScrollHandler
```

Boot and active session traverse the **exact same component tree**. Session-dependent data naturally degrades:
- `selectMessages(undefined)` → `EMPTY_MESSAGES` (empty array)
- `selectPermissions(undefined)` → `EMPTY_PERMISSIONS` (empty array)
- `StatusLine` segments: session-dependent segments (status, ctx%, cost, tokens, diff) simply don't render
- `Messages` component: empty `filteredMessages` → `VirtualMessageList` renders nothing
- Logo + Tips: rendered when `messages.length === 0` (inside `scrollable` slot)

### Reference CLI Analysis

Both reference CLIs confirm the single-path approach:

**Claude Code**: Uses sequential pre-REPL dialogs for onboarding (`showSetupScreens()`) then a single REPL layout for everything. `getFocusedInputDialog()` returns one of ~20 dialog states — all rendered within the same REPL. No separate "boot screen".

**Gemini CLI**: Single `AppContainer` for everything. Auth state tracked inline (`authState === AuthState.Unauthenticated` shows blocking dialog inside same layout). Model checked at submit time, not boot.

### Onboarding (Claude Code Style — Adopted)

Claude Code shows `Not logged in · Run /login` in the status line. On submit, shows inline error. **No blocking wizard.** LiteAI adopts this:
- StatusLine shows `No provider · Run /provider` when `provider_next.connected.length === 0`
- Submit already shows `"No model selected. Use /models to configure a provider and model."` toast
- A dedicated onboarding wizard is orthogonal — can be added in a later phase

### Exit Summary (Gemini CLI Style — Adopted)

Gemini CLI shows an `Interaction Summary` box on `/quit` with Session ID, Tool Calls, Performance stats, and a resume command. LiteAI will adopt this:
- Capture stats snapshot before Ink unmounts
- Write summary to stdout in cleanup handler (after TUI exits)

```
┌─────────────────────────────────────────┐
│ Interaction Summary                     │
│ Model:        gemini-2.5-pro            │
│ Messages:     12                        │
│ Tool Calls:   8 (6 ✓ / 2 ✗)            │
│ Context:      45% used                  │
│ Cost:         $0.042                    │
│ Wall Time:    3m 22s                    │
│                                         │
│ To resume: liteai --resume <session-id> │
└─────────────────────────────────────────┘
```

### Session ID Display — Removed

> **Decided 2026-05-16**: The session ID segment in `StatusLine` (priority 8) is removed entirely. It is internal noise with no user value. Session ID is only surfaced in the exit summary resume command.

---

## Problem Statement

After Phase 2, all dialogs use `useKeybindings` instead of raw `useInput`. But the **focus arbitration** problem remains:

1. When a modal opens, the prompt's `useInput` must be silenced
2. When nested dialogs open (Config → Models), Escape must pop correctly
3. The `useNavigation.replace()` race condition (close + open in two renders) needs fixing
4. `BlankSession` duplicates 30 lines of modal rendering logic from `SessionLayout`, creating a divergent code path for focus management

---

## Deliverable 1: Focus Arbiter

### Current (Fragile)
```tsx
// Scattered across components — each checks isDialogOpen independently
useInput(handler, { isActive: !modalPane.isOpen && !isComposing })
```

### Target (Centralized)

> **Decided 2026-05-16**: Derive focus in `SessionRoute`, not `AppContent`. Keep it simple — no `useState` focus enum.

```tsx
// SessionRoute derives focus
const promptFocused = !modalPane.isOpen && !cursor.active

// Pass to PromptInput
<PromptInput focus={promptFocused} />
```

### Implementation

#### `routes/session/index.tsx` Changes
- Derive `promptFocused` from `!modalPane.isOpen && !cursor.active`
- Pass `focus={promptFocused}` to `PromptInput` via `SessionBottom`

#### `prompt-input.tsx` Changes
- Accept `focus: boolean` prop (required, not optional)
- Remove internal `modalPane.isOpen` focus derivation entirely
- At the `useTextInput` call: `focus: focus && !searchState.isSearching && !cursorModeActive`
- All callers must pass `focus` — no fallback to internal modal state

---

## Deliverable 2: Modal Stack Semantics

### Current (Single-Slot)
```typescript
type ModalPaneCtx = {
  content: ReactNode | null
  isOpen: boolean
  openModal: (content: ReactNode) => void
  closeModal: () => void
}
```

### Target (Stack-Based)
```typescript
type ModalPaneCtx = {
  stack: ReactNode[]
  content: ReactNode | null   // derived: stack.at(-1) ?? null
  isOpen: boolean             // derived: stack.length > 0
  
  openModal: (content: ReactNode) => void   // clears stack, pushes new
  pushModal: (content: ReactNode) => void   // sub-navigation push
  popModal: () => void                       // sub-navigation pop
  closeModal: () => void                     // clears entire stack
}
```

### Semantic Rules

| Operation | Stack Effect | When to Use |
|-----------|-------------|-------------|
| `openModal(content)` | `stack = [content]` | Top-level: `/models`, `/config` |
| `pushModal(content)` | `stack = [...stack, content]` | Sub-navigation: Config → Models |
| `popModal()` | `stack = stack.slice(0, -1)` | Esc in sub-dialog |
| `closeModal()` | `stack = []` | Full close, Ctrl+C |

### Wire to `useNavigation`

```diff
 return useMemo(() => ({
-  open: (content) => modalPane.openModal(content),
-  close: () => modalPane.closeModal(),
-  replace: (content) => {
-    modalPane.closeModal()
-    modalPane.openModal(content)
-  },
+  open: (content) => modalPane.pushModal(content),
+  close: () => modalPane.popModal(),
+  replace: (content) => {
+    modalPane.popModal()
+    modalPane.pushModal(content)
+  },
 }), [modalPane])
```

**Effect:** `navigation.open()` from within a dialog pushes a sub-view. `navigation.close()` (Esc) pops back to the parent. This is correct semantics.

---

## Deliverable 3: Escape Chain Resolution

### Problem
When `DialogConfig` → opens `DialogModel`:
1. Both bind Escape in different keybinding contexts
2. Which handler fires first is undefined
3. Result: Escape may close everything, or close the wrong thing

### Solution
With the modal stack + `useDialogLifecycle`:

```tsx
function DialogConfig({ onClose }) {
  useDialogLifecycle({ contextName: "Config", onClose })
  
  const handleOpenModels = () => {
    // pushModal adds to stack — Esc in Models will popModal back here
    navigation.open(<DialogModel onClose={() => navigation.close()} />)
  }
}
```

The escape chain becomes deterministic:
1. `DialogModel` has `useDialogLifecycle({ onClose: navigation.close })`
2. `navigation.close()` = `popModal()` = removes DialogModel from stack
3. `DialogConfig` (still on stack) becomes visible again
4. Pressing Esc again → `DialogConfig`'s `useDialogLifecycle` fires → `onClose` → closes all

---

## Deliverable 4: Replace Atomicity Fix

### Problem
```typescript
replace: (content) => {
  modalPane.closeModal()    // setState(null)
  modalPane.openModal(content)  // setState(content)
}
```
React may not batch these in all async paths, causing a focus flicker.

### Solution
```typescript
replace: (content) => {
  // Single atomic state update
  modalPane.replaceTop(content)
}
```

Add `replaceTop` to `ModalPaneCtx`:
```typescript
replaceTop: (content: ReactNode) => void  // stack[-1] = content (single render)
```

---

## Deliverable 5: BlankSession Elimination + Unified StatusLine

### Problem

The `BlankSession` / `SessionRoute` split creates two divergent code paths:

1. **Duplicated modal rendering**: `BlankSessionContent` manually reimplements 30 lines of absolute-positioned modal pane logic (L130-148 of `app.tsx`) that `SessionLayout` already provides.
2. **Divergent focus paths**: Focus management, keybinding contexts, and overlay rendering work differently in blank vs. active states.
3. **Two PromptInput mount points**: The same `<PromptInput>` renders in different container hierarchies.

### Solution: Zero Branching — Unify Into `SessionRoute`

`SessionRoute` already handles lazy session creation via `SessionProvider.ensureSession()`. The blank state is simply "SessionRoute where `messages.length === 0`".

#### `app.tsx` — Delete BlankSession, unify AppContent

```tsx
function AppContent() {
  const route = useRoute()
  const sessionID = route.data.sessionID

  // When no session, render single SessionRoute with undefined sessionID.
  // When sessions exist, render tab set. Both use the same component.
  if (!sessionID) {
    return (
      <ModalPaneProvider>
        <SessionRoute />
      </ModalPaneProvider>
    )
  }

  return (
    <>
      {tabs.map((id) => (
        <Box key={id} display={id === activeTabId ? "flex" : "none"} ...>
          <ModalPaneProvider>
            <SessionRoute sessionID={id} />
          </ModalPaneProvider>
        </Box>
      ))}
    </>
  )
}
```

> The remaining `if (!sessionID)` is about tab wrapping (single vs multi), not rendering different components. Both branches render `<SessionRoute>`.

#### `SessionRoute` — Conditional scrollable content

The ONE conditional render — data-driven (empty vs non-empty messages), not structural:

```tsx
scrollable={
  <MessageCursorContext.Provider value={...}>
    {messages.length === 0 ? (
      <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
        <Logo />
        <Box height={2} />
        <Tips />
      </Box>
    ) : (
      <Messages scrollRef={scrollRef} />
    )}
  </MessageCursorContext.Provider>
}
```

### `sessionID` Cascade Impact (Verified Minimal)

> **Decided 2026-05-16**: Widen `sessionID` to `string | undefined`. The cascade is NOT 20+ files — it's 5 files with data-level guards.

| File | Change | Nature |
|------|--------|--------|
| `ctx.tsx` | `sessionID: string` → `string \| undefined` | Type widen (1 line) |
| `ctx.tsx` | Add `useOptionalSessionContext()` | Returns null instead of throwing |
| `app-state-selectors.ts` | Widen 5 selector params | Short-circuit return `EMPTY_*` |
| `status-line.tsx` | Widen prop, guard 5 segments, add onboarding segment | ~15 lines |
| `index.tsx` (SessionRoute) | Widen prop, guard sync/cleanup | ~10 lines |
| `tools.tsx` | **No change** — tool components never mount without messages |
| `messages.tsx` | **No change** — `selectMessages(undefined)` returns empty array |
| `parts.tsx` | **No change** — only renders inside MessageRow |
| `compact-summary.tsx` | **No change** — only renders inside message context |

**5 files modified, 0 functional changes to message/tool rendering.**

### Unified StatusLine

> **Decided 2026-05-16**: ONE StatusLine component for both boot and active states. Remove session ID segment entirely (internal noise).

**a) Widen prop:** `sessionID: string` → `sessionID?: string`

**b) Remove session ID segment** (priority 8)

**c) Guard session-dependent segments** — segments 1.8, 2, 3, 4, 7 only render when `sessionID` is defined. Segments 1, 1.5, 1.6, 1.7, 5, 6 always render.

**d) Add onboarding segment** (Claude Code style):
```typescript
// 1.9 Provider status — show when no provider connected
const connected = state.provider_next?.connected ?? []
if (connected.length === 0) {
  segments.push({
    priority: 1.9,
    text: "No provider · Run /provider",
    color: theme.warning as string,
  })
}
```

**e) Use `useOptionalSessionContext()`** instead of throwing `useSessionContext()` for `displayMode`.

### What Gets Eliminated

| Removed | Lines | Reason |
|---------|-------|--------|
| `BlankSession` component | 6 lines | Wrapper around `ModalPaneProvider` |
| `BlankSessionContent` component | 90 lines | Manual modal rendering, status bar, MCP count |
| Manual modal pane rendering | 18 lines | Duplicated from `SessionLayout` |
| Conditional branch in `AppContent` | 3 lines | `if (!route.data.sessionID) return <BlankSession />` |
| Session ID segment in StatusLine | 1 line | Internal noise |

**Total**: ~120 lines removed, single code path for all states.

### Migration Notes

- `SessionProvider` already handles `sessionID: undefined` — it calls `ensureSession()` on first submit
- `StatsProvider` degrades gracefully (all counters at 0)
- Focus arbiter from Deliverable 1 works identically — it reads `modalPane.isOpen`, which is available in both paths
- UI renders with empty prompt, session creation is lazy (on first submit)

---

## Deliverable 6: Exit Summary

When the user exits (Ctrl+C or `/quit`), render a Gemini-style interaction summary before the process exits.

Capture stats snapshot before Ink unmounts, write to stdout in cleanup handler.

Data available from `useStats()`:
- Model name, message count, tool call stats
- Context utilization, total cost, wall time
- Session ID for resume command

---

## Files Modified

| File | Change |
|------|--------|
| `context/modal-pane.tsx` | Add `replaceTop` method |
| `hooks/use-navigation.ts` | Wire `replace` to `replaceTop` |
| `app.tsx` | Delete `BlankSession`/`BlankSessionContent`, unify into `SessionRoute` |
| `components/prompt/prompt-input.tsx` | Accept `focus` prop |
| `components/status-line.tsx` | Unify, remove session ID, guard segments, add onboarding |
| `routes/session/ctx.tsx` | Widen `sessionID`, add `useOptionalSessionContext` |
| `state/app-state-selectors.ts` | Widen 5 selectors to accept `undefined` |
| `routes/session/index.tsx` | Widen prop, guard sync/cleanup, Logo+Tips, focus arbiter |

---

## Context Priority Chain (Enforced)

```
Priority (highest to lowest):
1. Dialog-specific context ("ModelDialog", "ProviderAuth")
2. Generic overlay context ("Select", "Confirm") 
3. Session context ("Session", "Chat")
4. Global context ("Global", "App")
```

This already works in the keybinding resolver. After Phase 2, all components register contexts. After Phase 3, focus gating ensures only one context stack is active.

---

## Acceptance Criteria

- [ ] Focus arbiter: opening a modal disables prompt input by construction (no `isActive` flag checking)
- [ ] Modal stack: `pushModal` + `popModal` work correctly for nested dialogs
- [ ] Escape chain: Config → Models → Esc → Config → Esc → prompt (deterministic)
- [ ] `replaceTop`: tab navigation in Config does not cause focus flicker
- [ ] No race condition in `replace` operation (single render cycle)
- [ ] `BlankSession` and `BlankSessionContent` are deleted — zero references
- [ ] Boot experience (Logo + Tips + Prompt + unified StatusLine) renders via `SessionRoute`
- [ ] All slash commands work identically at boot and mid-session
- [ ] StatusLine: session ID segment removed, onboarding hint shows when no provider
- [ ] Exit summary: Gemini-style interaction summary on quit
- [ ] `bun typecheck` passes
- [ ] `bun lint:fix` passes
