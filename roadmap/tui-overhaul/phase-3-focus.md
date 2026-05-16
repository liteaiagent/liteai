# Phase 3: Focus & Navigation Architecture

> **Status**: Not Started  
> **Depends On**: Phase 2 (Component Migration)  
> **Estimated Effort**: Medium (~3-5 days)

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
```tsx
// AppContent owns focus state
const [focusTarget, setFocusTarget] = useState<'prompt' | 'modal' | 'overlay'>('prompt')

// Derived from modal state
useEffect(() => {
  if (modalPane.isOpen) setFocusTarget('modal')
  else if (overlayActive) setFocusTarget('overlay')
  else setFocusTarget('prompt')
}, [modalPane.isOpen, overlayActive])

// Prompt receives explicit focus
<PromptInput focus={focusTarget === 'prompt'} />
```

### Implementation

#### `app.tsx` Changes
- Add `focusTarget` state to `AppContent`
- Derive from `modalPane.isOpen` + HITL overlay state
- Pass `focus={focusTarget === 'prompt'}` to `PromptInput`

#### `prompt-input.tsx` Changes
- Accept `focus: boolean` prop (already partially exists as `isActive`)
- Remove internal `modalPane.isOpen` checks — parent controls focus

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

## Deliverable 5: BlankSession Elimination

### Problem

The `BlankSession` / `SessionRoute` split creates two divergent code paths:

1. **Duplicated modal rendering**: `BlankSessionContent` manually reimplements 30 lines of absolute-positioned modal pane logic (L130-148 of `app.tsx`) that `SessionLayout` already provides. This duplication was the root cause of the original modal void bug.
2. **Divergent focus paths**: Focus management, keybinding contexts, and overlay rendering work differently in blank vs. active states.
3. **Two PromptInput mount points**: The same `<PromptInput>` renders in different container hierarchies, meaning focus gating and context behavior can diverge.

Both Gemini CLI and Claude Code use a **single rendering path** — when there's no history, the message area is empty but the layout is the same.

### Solution: Unify Into `SessionRoute`

`SessionRoute` already handles lazy session creation via `SessionProvider.ensureSession()`. The blank state is simply "SessionRoute where `messages.length === 0`".

```tsx
// AppContent (after)
function AppContent() {
  const route = useRoute()
  // ... tab management ...

  // ALWAYS render through SessionRoute — it handles sessionID: undefined
  return (
    <>
      {tabs.length === 0 ? (
        <ModalPaneProvider>
          <SessionRoute sessionID={undefined} />
        </ModalPaneProvider>
      ) : (
        tabs.map(id => (
          <Box key={id} display={id === activeTabId ? "flex" : "none"} ...>
            <ModalPaneProvider>
              <SessionRoute sessionID={id} />
            </ModalPaneProvider>
          </Box>
        ))
      )}
    </>
  )
}
```

Inside `SessionRoute`, when `sessionID` is undefined and `messages.length === 0`, render the Logo + Tips in the scrollable area:

```tsx
// SessionRoute scrollable content (when no messages)
{messages.length === 0 ? (
  <Box flexGrow={1} alignItems="center" justifyContent="center">
    <Logo />
    <Tips />
  </Box>
) : (
  <Messages scrollRef={scrollRef} />
)}
```

### What Gets Eliminated

| Removed | Lines | Reason |
|---------|-------|--------|
| `BlankSession` component | 6 lines | Wrapper around `ModalPaneProvider` |
| `BlankSessionContent` component | 90 lines | Manual modal rendering, status bar, MCP count |
| Manual modal pane rendering | 18 lines | Duplicated from `SessionLayout` |
| Conditional branch in `AppContent` | 3 lines | `if (!route.data.sessionID) return <BlankSession />` |

**Total**: ~117 lines removed, single code path for all states.

### What `SessionRoute` Gains

- Conditional Logo + Tips rendering when `messages.length === 0`
- `sessionID` prop becomes `string | undefined` (was `string`)
- StatusLine in blank state shows directory + MCP count (already in `SessionBottom`)

### Migration Notes

- `SessionProvider` already handles `sessionID: undefined` — it calls `ensureSession()` on first submit
- `StatsProvider` and `SessionProvider` (display context) need to handle undefined `sessionID` gracefully (empty stats, no cursor)
- Focus arbiter from Deliverable 1 works identically — it reads `modalPane.isOpen`, which is available in both paths

---

## Files Modified

| File | Change |
|------|--------|
| `context/modal-pane.tsx` | Stack-based state, `pushModal`, `popModal`, `replaceTop` |
| `hooks/use-navigation.ts` | Wire to stack: open=push, close=pop, replace=replaceTop |
| `app.tsx` | Focus arbiter + eliminate `BlankSession`/`BlankSessionContent`, unify into `SessionRoute` |
| `components/prompt/prompt-input.tsx` | Accept `focus` prop, remove internal modal checks |
| `components/session-layout.tsx` | Render `stack.at(-1)` instead of `content` |
| `routes/session/index.tsx` | Accept `sessionID: string | undefined`, conditional Logo/Tips rendering |

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
- [ ] Boot experience (Logo + Tips + Prompt) renders identically via `SessionRoute`
- [ ] All slash commands work identically at boot and mid-session
- [ ] `bun typecheck` passes
- [ ] `bun lint:fix` passes
