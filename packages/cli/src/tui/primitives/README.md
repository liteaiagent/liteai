# TUI Primitives

Reusable dialog and list primitives for building TUI interfaces in the LiteAI CLI.

## Hooks

### `useSelectList`

```typescript
import { useSelectList } from "./use-select-list"

const { selectedIndex, handlers, visibleItems } = useSelectList({
  items: [...],
  onSelect: (item) => { ... },
  pageSize: 10,
  showNumbers: true,
  isActive: true,
})
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `items` | `T[]` | required | Array of items to display |
| `onSelect` | `(item: T) => void` | required | Callback when an item is selected |
| `onCancel` | `() => void` | - | Callback when selection is cancelled (Escape) |
| `pageSize` | `number` | 10 | Number of visible items before scrolling |
| `showNumbers` | `boolean` | false | Show digit shortcuts (0-9) for quick selection |
| `isActive` | `boolean` | true | Enable/disable keyboard handling |
| `initialIndex` | `number` | 0 | Starting selected index |
| `filter` | `(item: T, query: string) => boolean` | - | Custom filter function for search |

**Returns:**

| Property | Type | Description |
|----------|------|-------------|
| `selectedIndex` | `number` | Currently highlighted item index |
| `handlers` | `Record<string, () => void>` | Keybinding handlers for navigation |
| `visibleItems` | `T[]` | Subset of items visible in current scroll window |
| `scrollOffset` | `number` | Current scroll position |
| `totalCount` | `number` | Total number of items (after filtering) |

---

### `useDialogLifecycle`

```typescript
import { useDialogLifecycle } from "./use-dialog-lifecycle"

useDialogLifecycle({
  contextName: "Select",
  onClose: () => { ... },
  isActive: true,
  preventCloseOn: () => false,
})
```

Manages the lifecycle of a dialog: registers a keybinding context, wires up
close/cancel handlers, and handles the escape key.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `contextName` | `KeybindingContextName` | required | Keybinding context to register |
| `onClose` | `() => void` | required | Callback when dialog closes |
| `isActive` | `boolean` | true | Enable/disable the dialog's keybindings |
| `preventCloseOn` | `() => boolean` | - | Return `true` to prevent close on Escape |

---

## Components

### `SelectList`

```tsx
import { SelectList } from "./select-list"

<SelectList
  items={items}
  onSelect={handleSelect}
  onCancel={handleClose}
  renderItem={({ item, isSelected }) => (
    <Text color={isSelected ? "cyan" : undefined}>
      {item.label}
    </Text>
  )}
  pageSize={8}
/>
```

A fully keyboard-navigable list with scroll windowing. Wraps `useSelectList`
with a default Ink rendering.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `items` | `T[]` | Items to render |
| `onSelect` | `(item: T) => void` | Selection callback |
| `onCancel` | `() => void` | Cancel callback (Escape) |
| `renderItem` | `(item: SelectItem<T>, ctx: RenderContext) => ReactNode` | Custom item renderer |
| `pageSize` | `number` | Visible item count |
| `showNumbers` | `boolean` | Digit shortcut overlay |
| `contextName` | `KeybindingContextName` | Override context (default: "Select") |

---

### `DialogPane`

```tsx
import { DialogPane } from "./dialog-pane"

<DialogPane
  title="Model Picker"
  footerHints={[
    { key: "Enter", label: "Select" },
    { key: "Esc", label: "Close" },
  ]}
>
  <SelectList ... />
</DialogPane>
```

A themed container for dialog content. Provides a title bar, bordered frame,
and footer hint pills.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `title` | `string` | Dialog title (rendered in the top bar) |
| `children` | `ReactNode` | Dialog content |
| `footerHints` | `FooterHint[]` | Bottom bar key hints |
| `width` | `number \| string` | Override width |

---

## Types

### `RenderContext`

Passed as the second argument to custom `renderItem` functions in `SelectList`.

| Field | Type | Description |
|-------|------|-------------|
| `isActive` | `boolean` | Whether this item is the currently highlighted item |
| `titleColor` | `string` | Computed foreground color (contrast-safe against active background) |
| `index` | `number` | The item's position in the full (unsliced) list |

### `FooterHint`

A key-label pair for auto-rendered footer hint bars in `DialogPane`.

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | Key name displayed to the user (e.g., `"Enter"`, `"Esc"`) |
| `label` | `string` | Action description (e.g., `"Select"`, `"Close"`) |

---

## Composition Patterns

> **Note:** The individual hook/component examples above use `./` imports (local
> perspective within the primitives directory). The composition examples below use
> `../primitives/` — they are written from the perspective of a consumer in a
> sibling directory (e.g., `components/`). Adjust the import prefix to match your
> file's location.

### Full Dialog Example

```tsx
import { DialogPane } from "../primitives/dialog-pane"
import { SelectList } from "../primitives/select-list"
import { useDialogLifecycle } from "../primitives/use-dialog-lifecycle"

function MyDialog({ items, onClose }: { items: Item[]; onClose: () => void }) {
  useDialogLifecycle({ contextName: "Select", onClose })

  return (
    <DialogPane
      title="Pick an Item"
      footerHints={[
        { key: "↑↓", label: "Navigate" },
        { key: "Enter", label: "Select" },
        { key: "Esc", label: "Close" },
      ]}
    >
      <SelectList
        items={items}
        onSelect={(item) => {
          // Handle selection
          onClose()
        }}
        onCancel={onClose}
        renderItem={({ item, isSelected }) => (
          <Text color={isSelected ? "cyan" : undefined}>
            {item.name}
          </Text>
        )}
      />
    </DialogPane>
  )
}
```

### Using with ModalPaneProvider

```tsx
import { useModalPane } from "../context/modal-pane"

const modalPane = useModalPane()

// Open a dialog
modalPane.openModal(
  <MyDialog
    items={items}
    onClose={() => modalPane.closeModal()}
  />
)
```
