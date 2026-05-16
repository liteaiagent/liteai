# 05 — Input Ownership Protocol

## The Core Problem

LiteAI has **18 files** with raw `useInput` calls. When multiple components are mounted, their handlers all fire on every keypress. There's no arbitration — whichever handler calls `setSelected(...)` last wins.

The keybinding context system (`useRegisterKeybindingContext` + `useKeybindings`) was built to solve this, but it's not enforced. Components bypass it with `useInput` for "simplicity."

---

## The Protocol

### Rule 1: No Raw `useInput` in Dialog Components

Every dialog-level component must use `useKeybindings` with an explicit context name:

```typescript
// ❌ FORBIDDEN in dialog components
useInput((input, key) => {
  if (key.upArrow) moveUp()
  if (key.return) select()
})

// ✓ REQUIRED
useRegisterKeybindingContext("ModelDialog")
useKeybindings({
  "select:previous": () => moveUp(),
  "select:accept": () => select(),
}, { context: "Select" })
```

**Exceptions** (raw `useInput` is OK for):
- `base-text-input.tsx` — Character-level input that doesn't map to named actions
- `keybinding-setup.tsx` — The interceptor that routes keys to the context system
- `scroll-handler.tsx` — Low-level scroll events

### Rule 2: Focus Gating

Every input hook must check whether it should be active:

```typescript
// ❌ Always-active (steals input from modals)
useKeybindings(handlers, { context: "Global" })

// ✓ Focus-gated
useKeybindings(handlers, { 
  context: "Global",
  isActive: !modalPane.isOpen   // yield to modal
})
```

### Rule 3: Context Priority Chain

When multiple contexts are active, the most specific one wins:

```
Priority (highest to lowest):
1. Dialog-specific context ("ModelDialog", "ProviderAuth")
2. Generic overlay context ("Select", "Confirm")
3. Session context ("Session")
4. Global context ("Global")
```

This already works in our keybinding resolver. The issue is that components don't register contexts.

---

## How It Works Today vs. How It Should Work

### Current Flow (Broken)

```
Keypress "↑"
  ├── PromptInput.useInput() → moves cursor up (WRONG — modal is open)
  ├── DialogSelect.useKeybindings("select:previous") → moves selection up
  └── ScrollHandler.useInput() → scrolls transcript
```

All three fire. The last one to call setState wins (non-deterministic).

### Proposed Flow (Fixed)

```
Keypress "↑"
  ├── KeybindingInterceptor intercepts
  ├── Resolves active contexts: ["ModelDialog", "Select", "Global"]
  ├── Finds binding: "select:previous" in "Select" context
  ├── Invokes handler: moveSelectionUp()
  └── STOPS. No further handlers fire.
```

This flow already exists in our `ChordInterceptor`. The gap is that `PromptInput` and `ScrollHandler` use raw `useInput` — they don't participate in the keybinding resolution.

---

## Migration Strategy for `useInput` Calls

### Phase 1: Gate the Prompt (Immediate)

The single biggest fix. PromptInput's `useInput` needs a focus gate:

```diff
// prompt-input.tsx
useInput(
  (input, key) => { ... },
- { isActive: !isComposing }
+ { isActive: !isComposing && !modalPane.isOpen }
)
```

This alone fixes input conflicts for ALL modals, without changing any other file.

### Phase 2: Migrate Dialogs (Incremental)

Each dialog's raw `useInput` → `useKeybindings`:

| File | Current | Action |
|------|---------|--------|
| `dialog-confirm.tsx` | `useInput` for enter/esc | → `useKeybindings("select:accept", "select:cancel")` |
| `dialog-alert.tsx` | `useInput` for any key | → `useKeybindings("select:accept")` |
| `question.tsx` | `useInput` for tab/up/esc | → `useKeybindings` + `useDialogLifecycle` |
| `dialog-session-list.tsx` | `useInput` for enter/esc | → `useSelectList` + `useDialogLifecycle` |
| `dialog-stats.tsx` | `useInput` for esc | → `useDialogLifecycle` |
| `dialog-plugin.tsx` | `useInput` for navigation | → `useSelectList` |
| `dialog-rewind.tsx` | `useInput` for navigation | → `useSelectList` |
| `dialog-feedback.tsx` | `useInput` for number keys | → `useSelectList` |
| `Tabs.tsx` | `useInput` for tab/arrows | → `useKeybindings` with `"Tabs"` context |
| `fuzzy-picker.tsx` | `useInput` for arrows/enter | → `useSelectList` |
| `feedback-survey.tsx` | `useInput` for selection | → `useSelectList` |
| `dialog-export-options.tsx` | `useInput` for navigation | → `useSelectList` |

### Phase 3: Lint Rule (Enforcement)

Add a Biome/ESLint rule:
```
warn: useInput is forbidden in dialog components. Use useKeybindings or useSelectList.
allow: base-text-input.tsx, keybinding-setup.tsx, scroll-handler.tsx
```

---

## Relationship to Alternative A (Replace Prompt)

Alternative A (from the implementation plan) makes Phase 1 unnecessary — if the prompt unmounts when a modal opens, its `useInput` can't fire. But Phase 2 and 3 are still valuable because:

1. Non-modal overlays (permission prompt, question tool) can still conflict with each other
2. Tab navigation within dialogs still uses raw `useInput`
3. Proper context registration enables the keybinding help display (`?` to show active keys)

**Alternative A + Input Protocol = belt and suspenders.** Alternative A is the quick fix. The protocol is the long-term investment.
