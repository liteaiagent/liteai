# 04 — Proposed Standard Primitives

## Overview

Three hooks + two components. This is the entire investment. Every future dialog composes from these.

---

## Primitive 1: `useSelectList` (Headless Hook)

**Inspired by**: Gemini CLI's `useSelectionList` (485 LOC) — proven in production.

### API

```typescript
interface SelectListOptions<T> {
  items: SelectItem<T>[]
  initialIndex?: number
  onSelect: (value: T) => void
  onHighlight?: (value: T) => void
  isFocused?: boolean          // gates all input handling
  wrapAround?: boolean         // default: true
  showNumbers?: boolean        // 1-9 quick select
}

interface SelectItem<T> {
  key: string                  // stable identity
  value: T
  label: string
  description?: string
  disabled?: boolean
  category?: string            // for grouped rendering
}

interface SelectListState<T> {
  activeIndex: number
  setActiveIndex: (index: number) => void
  activeItem: SelectItem<T> | undefined
  visibleItems: SelectItem<T>[]  // windowed for scroll
  scrollOffset: number
}

function useSelectList<T>(options: SelectListOptions<T>): SelectListState<T>
```

### What It Handles (So Individual Dialogs Don't)
- ✓ Up/down arrow navigation
- ✓ Enter to select
- ✓ Number keys for quick selection (1-9, multi-digit with timeout)
- ✓ Disabled item skipping
- ✓ Wrap-around at list boundaries
- ✓ Scroll windowing (only N items visible)
- ✓ Focus gating (no input when `isFocused=false`)
- ✓ Uses `useKeybindings` with `"Select"` context (not raw `useInput`)

### What It Does NOT Handle
- Rendering (headless — no JSX)
- Filtering/fuzzy search (separate concern)
- Multi-select (separate hook if needed)
- Grouping/categorization (rendering concern)

### Test Cases
```
✓ up/down moves selection
✓ wraps from last to first (when wrapAround=true)
✓ stops at boundaries (when wrapAround=false)
✓ skips disabled items
✓ number key selects directly
✓ multi-digit number with timeout
✓ no-op when isFocused=false
✓ Enter calls onSelect with active item's value
✓ onHighlight fires on navigation
✓ scroll window follows active index
```

---

## Primitive 2: `SelectList` (Rendering Component)

**Pairs with**: `useSelectList` (consumes its state).

### API

```tsx
interface SelectListProps<T> {
  items: SelectItem<T>[]
  activeIndex: number
  scrollOffset?: number
  visibleCount?: number        // default: 10
  renderItem?: (item: SelectItem<T>, context: RenderContext) => ReactNode
  showNumbers?: boolean
  showScrollIndicators?: boolean
}

interface RenderContext {
  isActive: boolean
  titleColor: string
  index: number
}

function SelectList<T>(props: SelectListProps<T>): ReactNode
```

### Default Rendering
```
 ● 1. Claude Sonnet 4          ← active (highlighted)
   2. Claude Opus 4
   3. Gemini 2.5 Pro
   4. GPT-4.1                  ← disabled (dimmed)
   5. Custom model...
                               ▼ 3 more
```

### Composability

The `renderItem` prop lets any dialog customize item appearance while keeping the selection chrome (indicator, numbering, scroll arrows) consistent:

```tsx
// Simple: default rendering
<SelectList items={models} activeIndex={state.activeIndex} />

// Custom: provider dialog with auth status badges
<SelectList
  items={providers}
  activeIndex={state.activeIndex}
  renderItem={(item, ctx) => (
    <Box gap={1}>
      <Text color={ctx.titleColor}>{item.label}</Text>
      {item.value.isConnected && <Text color="green">●</Text>}
    </Box>
  )}
/>
```

---

## Primitive 3: `useDialogLifecycle` (Lifecycle Hook)

**This is the "fix it once, fix it everywhere" hook.** Every dialog that uses this gets:

### API

```typescript
interface DialogLifecycleOptions {
  contextName: string          // keybinding context identifier
  onClose: () => void          // called on Esc
  isActive?: boolean           // default: true
  preventCloseOn?: () => boolean  // e.g., don't close if text input is dirty
}

function useDialogLifecycle(options: DialogLifecycleOptions): void
```

### What It Handles
- ✓ Registers keybinding context on mount
- ✓ Unregisters on unmount (cleanup)
- ✓ Binds `select:cancel` (Esc) to `onClose`
- ✓ Respects `preventCloseOn` for dirty-state protection
- ✓ Integrates with `useRegisterKeybindingContext` (not raw `useInput`)

### Usage Pattern

```tsx
function ModelDialog({ onClose }) {
  useDialogLifecycle({ contextName: "ModelDialog", onClose })
  // ... dialog content
}
```

**Every dialog that uses this hook will correctly handle Esc.** No more missing handlers.

---

## Primitive 4: `DialogPane` (Visual Wrapper)

### API

```tsx
interface DialogPaneProps {
  title: string
  children: ReactNode
  footer?: ReactNode           // keybinding hints
  footerHints?: FooterHint[]   // auto-rendered hint bar
}

interface FooterHint {
  key: string                  // "enter", "esc", "tab"
  label: string                // "select", "close", "switch"
}

function DialogPane(props: DialogPaneProps): ReactNode
```

### Rendering

```
─── Select Model ──────────────────────────
│                                          │
│  [dialog content here]                   │
│                                          │
│  enter select   esc close   tab switch   │
────────────────────────────────────────────
```

### Design Decision: Automatic Footer Hints

Instead of each dialog manually rendering `<Text dim>esc close</Text>`, the `footerHints` prop generates them consistently:

```tsx
<DialogPane
  title="Select Provider"
  footerHints={[
    { key: "enter", label: "select" },
    { key: "esc", label: "back" },
    { key: "tab", label: "switch mode" },
  ]}
>
  <SelectList ... />
</DialogPane>
```

---

## Composition Example: Full Dialog

```tsx
function ProviderSelectDialog({ onClose, onSelect }) {
  // Lifecycle: Esc handling, focus context
  useDialogLifecycle({ contextName: "ProviderSelect", onClose })
  
  // Selection: up/down/enter/numbers
  const selection = useSelectList({
    items: providers,
    onSelect: (provider) => onSelect(provider),
    isFocused: true,
  })
  
  // Render: standard chrome + standard list
  return (
    <DialogPane
      title="Select Provider"
      footerHints={[
        { key: "enter", label: "connect" },
        { key: "esc", label: "close" },
      ]}
    >
      <SelectList
        items={providers}
        activeIndex={selection.activeIndex}
        renderItem={(item, ctx) => (
          <Box gap={1}>
            <Text color={ctx.titleColor}>{item.label}</Text>
            <StatusBadge status={item.value.status} />
          </Box>
        )}
      />
    </DialogPane>
  )
}
```

**~30 lines.** Compare to the current `DialogSelect` at 323 lines, which still has bugs.

---

## Migration Path

| Priority | Component | Current | Migration |
|----------|-----------|---------|-----------|
| 1 | `PermissionPrompt` | Inline selection | Replace with `useSelectList` |
| 2 | `QuestionPrompt` | Inline selection + `useInput` | Replace with `useSelectList` + `useDialogLifecycle` |
| 3 | `DialogSelect` | Monolith | Split into `useSelectList` + `SelectList` (wrapper keeps API for backward compat) |
| 4 | Provider auth dialogs | `DialogSelect` + ViewState machine | Add `useDialogLifecycle`, keep ViewState |
| 5 | `Tabs` | Raw `useInput` | Migrate to `useKeybindings` with proper context |
| 6 | `FuzzyPicker` | Raw `useInput` | Migrate to `useKeybindings` |

---

## Test Strategy

```
packages/cli/src/tui/primitives/
  __tests__/
    use-select-list.test.ts     ← headless hook tests (30+ cases)
    use-dialog-lifecycle.test.ts ← mount/unmount/Esc tests
  use-select-list.ts
  use-dialog-lifecycle.ts
  select-list.tsx
  dialog-pane.tsx
```

Tests run fast (no rendering for hook tests), cover all edge cases, and every dialog inherits their guarantees.
