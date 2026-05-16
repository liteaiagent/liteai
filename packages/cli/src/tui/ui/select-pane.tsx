/**
 * SelectPane — standard filterable selection dialog.
 *
 * Replaces the legacy `DialogSelect` monolith. Composes Phase 1 primitives:
 * - `useDialogLifecycle` for Esc/cancel ownership
 * - `useSelectList` for all navigation and selection logic
 * - `DialogPane` for visual chrome (border, title, footer)
 * - `SelectList` for item rendering (scroll windowing, categories)
 *
 * The fuzzy filter is kept in-component (fuzzysort) since it is not a
 * primitive concern — it is specific to this filtered-selection pattern.
 *
 * @module ui/select-pane
 */

import type { Color } from "@liteai/ink"
import { Box, TerminalSizeContext, Text } from "@liteai/ink"
import fuzzysort from "fuzzysort"
import type React from "react"
import { useContext, useEffect, useImperativeHandle, useMemo, useState } from "react"
import { TextInput } from "../components/text-input"
import { useTheme } from "../context/theme"
import { SelectList } from "../primitives/select-list"
import type { SelectItem } from "../primitives/types"
import { useDialogLifecycle } from "../primitives/use-dialog-lifecycle"
import { useSelectList } from "../primitives/use-select-list"

export type { SelectItem }

export interface SelectPaneRef<T> {
  filter: string
  filtered: SelectItem<T>[]
}

export interface SelectPaneProps<T> {
  title: string
  items: SelectItem<T>[]
  onSelect: (item: SelectItem<T>) => void
  /** Called on Escape. When omitted, Esc is a no-op. */
  onClose?: () => void
  placeholder?: string
  /** Value of the currently active item — renders a ● indicator. */
  current?: T
  /** Extra content rendered between title and filter input. */
  header?: React.ReactNode
  /** Content appended to the right of the title. */
  headerEnd?: React.ReactNode
  /** Custom footer JSX (overrides footerHints auto-render). */
  footerContent?: React.ReactNode
  /**
   * When true, fuzzysort filtering is skipped. Use when results are
   * pre-filtered externally (e.g., server-side search).
   */
  skipFilter?: boolean
  /** Called when the filter text changes. */
  onFilter?: (query: string) => void
  /** Called when the highlighted item changes. */
  onHighlight?: (item: SelectItem<T>) => void
  /**
   * When true, category groups are flattened while the filter is active.
   * Items from different categories appear in a single flat list during search.
   */
  flat?: boolean
  ref?: React.Ref<SelectPaneRef<T>>
}

export function SelectPane<T>(props: SelectPaneProps<T>): React.ReactNode {
  const { theme } = useTheme()
  const terminalSize = useContext(TerminalSizeContext)

  const [query, setQuery] = useState("")

  // Fuzzy filter
  const filtered = useMemo<SelectItem<T>[]>(() => {
    if (props.skipFilter) {
      return props.items.filter((x) => !x.disabled)
    }
    const needle = query.toLowerCase()
    const validItems = props.items.filter((x) => !x.disabled)
    if (!needle) return validItems

    const results = fuzzysort.go(needle, validItems, {
      keys: ["label", "category"],
      scoreFn: (r) => (r[0] ? r[0].score * 2 : 0) + (r[1] ? r[1].score : 0),
    })
    return results.map((x) => x.obj)
  }, [props.items, query, props.skipFilter])

  // Flatten categories when filter is active and flat=true
  const flatten = props.flat && query.length > 0
  const displayItems = useMemo<SelectItem<T>[]>(() => {
    if (flatten) return filtered.map((item) => ({ ...item, category: undefined }))
    return filtered
  }, [filtered, flatten])

  // Find initial index for current value
  const initialIndex = useMemo(() => {
    if (props.current === undefined) return 0
    const idx = displayItems.findIndex((item) => {
      try {
        return JSON.stringify(item.value) === JSON.stringify(props.current)
      } catch {
        return item.value === props.current
      }
    })
    return idx >= 0 ? idx : 0
  }, [displayItems, props.current])

  // Lifecycle — Esc ownership
  useDialogLifecycle({
    contextName: "Select",
    onClose: props.onClose ?? (() => {}),
    isActive: !!props.onClose,
  })

  // Selection logic
  const { activeIndex } = useSelectList<T>({
    items: displayItems,
    initialIndex,
    onSelect: (value) => {
      const item = displayItems.find((i) => i.value === value)
      if (item) props.onSelect(item)
    },
    onHighlight: (value) => {
      const item = displayItems.find((i) => i.value === value)
      if (item) props.onHighlight?.(item)
    },
  })

  // Fire onFilter
  useEffect(() => {
    props.onFilter?.(query)
  }, [query, props.onFilter])

  // Imperative ref for filter/filtered access
  useImperativeHandle(props.ref, () => ({
    get filter() {
      return query
    },
    get filtered() {
      return filtered
    },
  }))

  // Scroll windowing: half the terminal height minus chrome overhead
  const terminalHeight = terminalSize?.rows ?? 24
  const visibleCount = Math.max(3, Math.floor(terminalHeight / 2) - 6)

  return (
    <Box flexDirection="column" gap={1} paddingBottom={1}>
      {/* Header row */}
      <Box paddingLeft={4} paddingRight={4} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={2}>
            <Text color={theme.text as Color} bold>
              {props.title}
            </Text>
            {props.headerEnd}
          </Box>
          {props.onClose && <Text color={theme.textMuted as Color}>esc</Text>}
        </Box>

        {/* Filter input */}
        <Box paddingTop={1}>
          <Box borderStyle="round" paddingX={1} borderColor="ansi:blue" width="100%">
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder={props.placeholder ?? "Search"}
              disableCursorMovementForUpDownKeys={true}
              disableEscapeDoublePress={true}
              focus={true}
              inputFilter={(_input, key) => {
                // Navigation keys are exclusively handled by useSelectList via useKeybindings("Select").
                // Filtering them here prevents the dual-useInput conflict.
                if (
                  key.upArrow ||
                  key.downArrow ||
                  key.pageUp ||
                  key.pageDown ||
                  key.home ||
                  key.end ||
                  key.return ||
                  key.escape
                ) {
                  return ""
                }
                return _input
              }}
            />
          </Box>
        </Box>
      </Box>

      {/* Optional custom header content */}
      {props.header && (
        <Box paddingLeft={4} paddingRight={4} paddingTop={1} paddingBottom={1}>
          {props.header}
        </Box>
      )}

      {/* Item list */}
      <Box paddingLeft={1} paddingRight={1}>
        <SelectList<T>
          items={displayItems}
          activeIndex={activeIndex}
          visibleCount={visibleCount}
          showScrollIndicators={displayItems.length > visibleCount}
          renderItem={(item, context) => {
            // Mark the current value with a ● gutter indicator
            const isCurrent = (() => {
              try {
                return JSON.stringify(item.value) === JSON.stringify(props.current)
              } catch {
                return item.value === props.current
              }
            })()

            // For items that use the current marker, render the ● gutter inline
            if (isCurrent && !item.gutter) {
              return (
                <Box alignItems="flex-start">
                  <Box minWidth={2} flexShrink={0}>
                    <Text color={context.isActive ? (theme.background as Color) : (theme.primary as Color)}>●</Text>
                  </Box>
                  <Box flexGrow={1} gap={1}>
                    <Text bold={context.isActive} color={context.titleColor as Color}>
                      {item.label}
                    </Text>
                    {item.description && item.description !== item.category && (
                      <Text color={context.isActive ? (theme.background as Color) : (theme.textMuted as Color)}>
                        {item.description}
                      </Text>
                    )}
                  </Box>
                  {item.footer && (
                    <Box flexShrink={0} marginLeft={1}>
                      {typeof item.footer === "string" ? (
                        <Text color={context.isActive ? (theme.background as Color) : (theme.textMuted as Color)}>
                          {item.footer}
                        </Text>
                      ) : (
                        item.footer
                      )}
                    </Box>
                  )}
                </Box>
              )
            }

            // Default rendering (SelectList handles gutter/footer via DefaultSelectListItem)
            return undefined
          }}
        />
      </Box>

      {/* Footer content */}
      {props.footerContent && (
        <Box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
          {props.footerContent}
        </Box>
      )}
    </Box>
  )
}
