# Phase 1: Standard Primitives

> **Status**: Not Started  
> **Depends On**: None  
> **Estimated Effort**: Medium (~1 week)

---

## Agent Context

Load these files before starting implementation.

### Roadmap Docs
- `d:\liteai\roadmap\tui-overhaul\phase-1-primitives.md` — this file (API designs, test cases)
- `d:\liteai\roadmap\tui-overhaul\design\decisions.md` — locked decisions (composition over classes, protocol over framework)

### LiteAI Source (understand what primitives replace)
- `d:\liteai\packages\cli\src\tui\ui\dialog-select.tsx` — current 323-line monolith being decomposed
- `d:\liteai\packages\cli\src\tui\keybindings\use-keybinding.ts` — `useKeybindings` API to compose with
- `d:\liteai\packages\cli\src\tui\keybindings\keybinding-context.tsx` — `useRegisterKeybindingContext` API
- `d:\liteai\packages\cli\src\tui\keybindings\default-bindings.ts` — existing `Select` context bindings

### Gemini CLI Reference (primary model for `useSelectList`)
- `D:\gemini-cli\packages\cli\src\ui\hooks\useSelectionList.ts` — headless selection hook (485 LOC)
- `D:\gemini-cli\packages\cli\src\ui\hooks\useSelectionList.test.tsx` — test patterns
- `D:\gemini-cli\packages\cli\src\ui\components\shared\BaseSelectionList.tsx` — selection rendering (276 LOC)

### Claude Code Reference (supplementary)
- `D:\claude-code\src\components\CustomSelect\use-select-navigation.ts` — headless selection hook
- `D:\claude-code\src\components\CustomSelect\use-select-state.ts` — selection state management
- `D:\claude-code\src\components\design-system\Pane.tsx` — dialog chrome wrapper


## Goal

Build the foundational hook/component library that every future dialog composes from. Three hooks + two components. This is the highest-ROI investment: once these primitives are tested, every dialog inherits their correctness guarantees.

---

## Deliverables

### Primitive 1: `useSelectList` (Headless Hook)

**Inspired by**: Gemini CLI's `useSelectionList` (485 LOC).

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

**Handles:**
- ✓ Up/down arrow navigation
- ✓ Enter to select
- ✓ Number keys for quick selection (1-9, multi-digit with timeout)
- ✓ Disabled item skipping
- ✓ Wrap-around at list boundaries
- ✓ Scroll windowing (only N items visible)
- ✓ Focus gating (`isFocused=false` → no-op)
- ✓ Uses `useKeybindings` with `"Select"` context (NOT raw `useInput`)

**Does NOT handle:**
- Rendering (headless — no JSX)
- Filtering/fuzzy search (separate concern)
- Multi-select (separate hook if needed)
- Grouping/categorization (rendering concern)

**Test Cases:**
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

### Primitive 2: `SelectList` (Rendering Component)

Pairs with `useSelectList` — consumes its state for rendering.

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

**Default rendering:**
```
 → 1. Claude Sonnet 4          ← active (highlighted)
   2. Claude Opus 4
   3. Gemini 2.5 Pro
   4. GPT-4.1                  ← disabled (dimmed)
   5. Custom model...
                                ▼ 3 more
```

**Custom rendering via `renderItem`:**
```tsx
// Provider dialog with auth status badges
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

### Primitive 3: `useDialogLifecycle` (Lifecycle Hook)

The "fix it once, fix it everywhere" hook. Every dialog that uses this gets correct Esc handling, focus context registration, and cleanup.

```typescript
interface DialogLifecycleOptions {
  contextName: string          // keybinding context identifier
  onClose: () => void          // called on Esc
  isActive?: boolean           // default: true
  preventCloseOn?: () => boolean  // e.g., don't close if text input is dirty
}

function useDialogLifecycle(options: DialogLifecycleOptions): void
```

**Handles:**
- ✓ Registers keybinding context on mount
- ✓ Unregisters on unmount (cleanup)
- ✓ Binds `select:cancel` (Esc) to `onClose`
- ✓ Respects `preventCloseOn` for dirty-state protection
- ✓ Uses `useRegisterKeybindingContext` (NOT raw `useInput`)

---

### Primitive 4: `DialogPane` (Visual Wrapper)

```tsx
interface DialogPaneProps {
  title: string
  children: ReactNode
  footer?: ReactNode           // custom footer
  footerHints?: FooterHint[]   // auto-rendered hint bar
}

interface FooterHint {
  key: string                  // "enter", "esc", "tab"
  label: string                // "select", "close", "switch"
}

function DialogPane(props: DialogPaneProps): ReactNode
```

**Rendering:**
```
─── Select Model ──────────────────────────
│                                          │
│  [dialog content here]                   │
│                                          │
│  enter select   esc close   tab switch   │
────────────────────────────────────────────
```

**Automatic footer hints** instead of each dialog manually rendering `<Text dim>esc close</Text>`.

---

## Composition Example

A complete dialog using all 4 primitives:

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

## File Structure

```
packages/cli/src/tui/primitives/
  __tests__/
    use-select-list.test.ts     ← headless hook tests (30+ cases)
    use-dialog-lifecycle.test.ts ← mount/unmount/Esc tests
    select-list.test.tsx        ← rendering tests
    dialog-pane.test.tsx        ← snapshot tests
  use-select-list.ts
  use-dialog-lifecycle.ts
  select-list.tsx
  dialog-pane.tsx
  types.ts                     ← shared types (SelectItem, FooterHint, etc.)
  index.ts                     ← barrel export
```

---

## Implementation Order

| # | Item | Depends On | Why This Order |
|---|------|-----------|----------------|
| 1 | `types.ts` | — | Shared types used by everything |
| 2 | `useDialogLifecycle` | — | Simplest hook, immediate value |
| 3 | `useSelectList` | — | Most complex hook, most test cases |
| 4 | `SelectList` | `useSelectList` types | Rendering layer for selection |
| 5 | `DialogPane` | `FooterHint` types | Visual wrapper, depends only on types |
| 6 | Integration test | All primitives | End-to-end: hook + component + lifecycle |

---

## Acceptance Criteria

- [ ] All 30+ unit tests for `useSelectList` pass
- [ ] `useDialogLifecycle` correctly registers/unregisters keybinding contexts
- [ ] `SelectList` renders correctly with default and custom `renderItem`
- [ ] `DialogPane` renders title, content, and footer hints consistently
- [ ] `bun typecheck` passes with zero errors in `primitives/`
- [ ] `bun lint:fix` passes
- [ ] No raw `useInput` calls in any primitive
