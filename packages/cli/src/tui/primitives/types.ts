/**
 * Shared type definitions for TUI primitive hooks and components.
 *
 * These types form the public API surface for the primitives layer.
 * All dialog-related hooks and components import from this module.
 */

import type { ReactNode } from "react"
import type { KeybindingContextName } from "../keybindings/types"

// ---------------------------------------------------------------------------
// Selection Primitives
// ---------------------------------------------------------------------------

/**
 * A single item in a selection list.
 *
 * @typeParam T - The value type carried by this item (e.g., provider config, model ID).
 */
export interface SelectItem<T> {
  /** Stable identity used for React keys and item tracking across re-renders. */
  key: string
  /** The domain value returned to the consumer on selection. */
  value: T
  /** Display label rendered in the list. */
  label: string
  /** Optional secondary text rendered beside the label. */
  description?: string
  /** When true, the item is visible but non-selectable (skipped during navigation). */
  disabled?: boolean
  /** Optional grouping key — items sharing a category are rendered under a shared header. */
  category?: string
}

/**
 * Options for the `useSelectList` headless hook.
 *
 * @typeParam T - The value type of selectable items.
 */
export interface SelectListOptions<T> {
  /** The full list of items to navigate. */
  items: SelectItem<T>[]
  /** Zero-based index to start selection at. Defaults to 0. */
  initialIndex?: number
  /** Called when the user confirms selection (Enter or unambiguous number key). */
  onSelect: (value: T) => void
  /** Called when the highlighted item changes during navigation. */
  onHighlight?: (value: T) => void
  /** When false, all input handling is disabled (no-op). Defaults to true. */
  isFocused?: boolean
  /** When true, navigation wraps from last→first and first→last. Defaults to true. */
  wrapAround?: boolean
  /** When true, enables 1-9 (and multi-digit) quick selection via digit keys. Defaults to false. */
  showNumbers?: boolean
}

/**
 * Return value of `useSelectList` — pure selection state, no rendering or windowing.
 *
 * Windowing (scroll offset, visible slice) is the responsibility of the
 * `SelectList` rendering component, not this hook.
 *
 * @typeParam T - The value type of selectable items.
 */
export interface SelectListState<T> {
  /** The currently highlighted item index (zero-based). */
  activeIndex: number
  /** Programmatically set the active index (bounds-checked by the reducer). */
  setActiveIndex: (index: number) => void
  /** The currently highlighted item, or undefined if the list is empty. */
  activeItem: SelectItem<T> | undefined
}

// ---------------------------------------------------------------------------
// SelectList Rendering Component
// ---------------------------------------------------------------------------

/**
 * Context passed to custom `renderItem` functions in `SelectList`.
 */
export interface RenderContext {
  /** Whether this item is the currently highlighted/active item. */
  isActive: boolean
  /** Computed foreground color for the item title (contrast-safe against active background). */
  titleColor: string
  /** The item's position in the full (unsliced) list. */
  index: number
}

/**
 * Props for the `SelectList` rendering component.
 *
 * @typeParam T - The value type of selectable items.
 */
export interface SelectListProps<T> {
  /** The full list of items to render. */
  items: SelectItem<T>[]
  /** Index of the currently active/highlighted item (from `useSelectList`). */
  activeIndex: number
  /** External scroll offset override. If omitted, computed internally via render-time derivation. */
  scrollOffset?: number
  /** Maximum number of items visible at once. Defaults to 10. */
  visibleCount?: number
  /** Custom item renderer. When omitted, default themed rendering is used. */
  renderItem?: (item: SelectItem<T>, context: RenderContext) => ReactNode
  /** When true, renders 1-based number indices beside each item. */
  showNumbers?: boolean
  /** When true, renders ▲/▼ scroll indicators when the list overflows. */
  showScrollIndicators?: boolean
}

// ---------------------------------------------------------------------------
// Dialog Lifecycle Hook
// ---------------------------------------------------------------------------

/**
 * Options for the `useDialogLifecycle` hook.
 *
 * This hook owns the Esc/cancel lifecycle for dialogs. Selection hooks
 * (e.g., `useSelectList`) do NOT handle Esc — that responsibility is
 * exclusively delegated to this hook.
 */
export interface DialogLifecycleOptions {
  /** Keybinding context name registered on mount and unregistered on unmount. */
  contextName: KeybindingContextName
  /** Called when the user presses Esc (unless `preventCloseOn` blocks it). */
  onClose: () => void
  /** When false, disables context registration and cancel handling. Defaults to true. */
  isActive?: boolean
  /** Guard function — when it returns true, Esc is suppressed (e.g., dirty input protection). */
  preventCloseOn?: () => boolean
}

// ---------------------------------------------------------------------------
// DialogPane Visual Wrapper
// ---------------------------------------------------------------------------

/**
 * A key-label pair for auto-rendered footer hint bars.
 */
export interface FooterHint {
  /** The key name displayed to the user (e.g., "enter", "esc", "tab"). */
  key: string
  /** The action description (e.g., "select", "close", "switch"). */
  label: string
}

/**
 * Props for the `DialogPane` visual wrapper component.
 */
export interface DialogPaneProps {
  /** Title rendered in the top border/header area. */
  title: string
  /** Dialog content (selection lists, forms, etc.). */
  children: ReactNode
  /** Custom footer JSX. Mutually exclusive with `footerHints` — if both provided, `footer` takes precedence. */
  footer?: ReactNode
  /** Auto-rendered hint bar entries. Ignored if `footer` is provided. */
  footerHints?: FooterHint[]
}
