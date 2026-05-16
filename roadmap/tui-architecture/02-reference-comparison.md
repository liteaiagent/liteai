# 02 — Reference Comparison: What They Actually Built

## The Surprising Finding

Neither Gemini CLI nor Claude Code has a centralized Screen framework. No `ScreenManager`, no `DialogBase`, no generic `NavigablePane`. Both converged on the same 3-layer architecture independently.

---

## Layer 1: Input Hook (Focus Ownership)

### Gemini CLI — `useKeypress` with Priority

```typescript
// From packages/cli/src/ui/hooks/useKeypress.ts
useKeypress(callback, { isActive, priority })
```

- `isActive` gates whether the hook fires at all
- `priority` determines which handler wins when multiple are active
- Dialog components set `priority: true` to override the Composer's input
- **Key insight**: There's no "focus manager." Each component declares its own priority.

### Claude Code — `useKeybinding` with Context

```typescript
// From src/keybindings/useKeybinding.ts
useKeybinding('select:cancel', handler, { context: 'ModelPicker' })
```

- Named contexts (`'ModelPicker'`, `'Select'`, `'PermissionPrompt'`)
- When a context is active, its bindings take precedence
- Uses `event.stopImmediatePropagation()` to prevent bubbling
- **Key insight**: Context names are just strings. No registry, no class hierarchy.

### LiteAI — `useKeybindings` with Context (Already Exists!)

```typescript
// From keybindings/use-keybinding.ts
useRegisterKeybindingContext("Select")
useKeybindings({ "select:cancel": handler }, { context: "Select" })
```

**We already have the equivalent system.** The problem is that 18 files bypass it with raw `useInput`.

---

## Layer 2: Selection Component (List Navigation)

### Gemini CLI — `BaseSelectionList` + `useSelectionList`

Split into:
- **`useSelectionList` (hook)**: 485 lines. Handles up/down/enter/number-key, disabled items, wrap-around, focus gating. Uses a `useReducer` state machine.
- **`BaseSelectionList` (component)**: 276 lines. Renders items with radio indicators, scroll arrows, theming. Delegates all input to the hook.

```tsx
// Usage pattern
<BaseSelectionList
  items={modelItems}
  onSelect={handleSelect}
  isFocused={true}
  renderItem={(item, ctx) => <Text color={ctx.titleColor}>{item.label}</Text>}
/>
```

### Claude Code — `Select` + `use-select-navigation`

Split into:
- **`use-select-navigation` (hook)**: 16K. Full navigation state machine with type-ahead, group-aware movement, cancellation.
- **`Select` (component)**: 30K. Renders options with highlighting, descriptions, grouping. Supports cancel via Esc.

```tsx
// Usage pattern
<Select
  options={modelOptions}
  onChange={handleSelect}
  onCancel={handleCancel}
  visibleOptionCount={10}
/>
```

### LiteAI — `DialogSelect`

**Single component**: 323 lines. Combines input handling, filtering, navigation, AND rendering into one monolith. Uses raw `useInput` for some paths.

```tsx
// Current usage
<DialogSelect
  title="Select model"
  options={modelOptions}
  onSelect={handleSelect}
  onEscape={handleEscape}
/>
```

**Problem**: Can't use `DialogSelect` for Question prompts (different layout). Can't use it for Permission prompts (different interaction model). So each reinvents navigation.

---

## Layer 3: Dialog Chrome (Visual Frame)

### Gemini CLI
- No standard wrapper. Each dialog uses inline `<Box>` with its own padding/borders.
- Minimal visual chrome — dialogs are clean text, no borders.

### Claude Code — `Pane` + `Dialog`
- **`Pane`**: Colored top divider + padding. Used by ALL slash commands.
- **`Dialog`**: Adds cancel/confirm keybindings on top of Pane. Used by confirmation flows.
- **Smart modal detection**: `Pane` checks `useIsInsideModal()` — if inside a modal slot, it skips its own border (the modal provides the `▔` divider).

### LiteAI — `ThemedBox` / `Pane` (inconsistent)
- `ThemedBox`: Border + theme color wrapper. Used by some dialogs.
- `Pane`: Divider + content. Used by others.
- Several dialogs use neither, just raw `<Box>` with inline styles.

---

## What This Tells Us

| Capability | Gemini CLI | Claude Code | LiteAI | Gap |
|-----------|-----------|-------------|--------|-----|
| Focus ownership hook | `useKeypress(cb, {priority})` | `useKeybinding(action, cb, {context})` | `useKeybindings(map, {context})` | **Exists but bypassed by raw `useInput`** |
| Headless selection hook | `useSelectionList` (485 LOC) | `use-select-navigation` (16K LOC) | **None** | **Missing — navigation baked into UI component** |
| Selection UI component | `BaseSelectionList` (276 LOC) | `Select` (30K LOC) | `DialogSelect` (323 LOC, monolith) | **Needs split into hook + component** |
| Dialog wrapper | None (inline) | `Pane` + `Dialog` | `ThemedBox` / `Pane` (inconsistent) | **Needs consolidation** |
| Focus gate on prompt | Composer unmounts | `focusedInputDialog` string enum | **None** | **Missing — root cause of input conflicts** |

---

## The Pattern That Emerges

```
┌─────────────────────────────────────────────┐
│ Layer 3: Dialog Chrome                       │
│ Pane / Dialog wrapper                        │
│ - Provides visual frame                      │
│ - Detects modal context                      │
├─────────────────────────────────────────────┤
│ Layer 2: Selection Primitives                │
│ useSelectList (hook) + SelectList (component)│
│ - Up/down/enter/number navigation            │
│ - Scroll windowing                           │
│ - Disabled item skipping                     │
├─────────────────────────────────────────────┤
│ Layer 1: Input Ownership Protocol            │
│ useKeybindings + context registration        │
│ - Focus gating                               │
│ - Priority resolution                        │
│ - Chord sequences                            │
└─────────────────────────────────────────────┘
```

**We need to build Layer 2 properly (headless selection hook) and enforce Layer 1 strictly (eliminate raw `useInput`).** Layer 3 is nice-to-have but doesn't fix bugs.
