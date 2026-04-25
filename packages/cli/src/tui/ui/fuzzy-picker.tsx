import { Box, Text, useInput } from "@liteai/ink"
import fuzzysort from "fuzzysort"
import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Byline } from "../components/design-system/Byline"
import { KeyboardShortcutHint } from "../components/design-system/KeyboardShortcutHint"
import { Pane } from "../components/design-system/Pane"
import ThemedBox from "../components/design-system/ThemedBox.tsx"
import ThemedText from "../components/design-system/ThemedText.tsx"

type PickerAction<T> = {
  action: string
  handler: (item: T) => void
}

type Props<T> = {
  title: string
  placeholder?: string
  initialQuery?: string
  items: readonly T[]
  getKey: (item: T) => string
  getSearchString?: (item: T) => string
  renderItem: (item: T, isFocused: boolean) => React.ReactNode
  renderPreview?: (item: T) => React.ReactNode
  previewPosition?: "bottom" | "right"
  visibleCount?: number
  direction?: "down" | "up"
  onQueryChange: (query: string) => void
  onSelect: (item: T) => void
  onTab?: PickerAction<T>
  onShiftTab?: PickerAction<T>
  onFocus?: (item: T | undefined) => void
  onCancel: () => void
  emptyMessage?: string | ((query: string) => string)
  matchLabel?: string
  selectAction?: string
  extraHints?: React.ReactNode
}

const DEFAULT_VISIBLE = 8

export function FuzzyPicker<T>({
  title,
  placeholder = "Type to search…",
  initialQuery = "",
  items,
  getKey,
  getSearchString,
  renderItem,
  renderPreview,
  previewPosition = "bottom",
  visibleCount = DEFAULT_VISIBLE,
  direction = "down",
  onQueryChange,
  onSelect,
  onTab,
  onShiftTab,
  onFocus,
  onCancel,
  emptyMessage = "No results",
  matchLabel,
  selectAction = "select",
  extraHints,
}: Props<T>): React.ReactNode {
  const [query, setQuery] = useState(initialQuery)
  const [focusedIndex, setFocusedIndex] = useState(0)

  const filteredItems = useMemo(() => {
    if (!getSearchString || !query.trim()) return items
    const results = fuzzysort.go(query, items, {
      key: getSearchString,
    })
    return results.map((r) => r.obj)
  }, [items, query, getSearchString])

  const step = (delta: 1 | -1) => {
    setFocusedIndex((i) => Math.max(0, Math.min(i + delta, filteredItems.length - 1)))
  }

  useInput((input, _key, event) => {
    if (!event) return

    const keyName = event.keypress.name
    const isCtrl = event.keypress.ctrl
    const isShift = event.keypress.shift

    if (keyName === "up" || (isCtrl && keyName === "p")) {
      step(direction === "up" ? 1 : -1)
      return
    }
    if (keyName === "down" || (isCtrl && keyName === "n")) {
      step(direction === "up" ? -1 : 1)
      return
    }
    if (keyName === "return") {
      const selected = filteredItems[focusedIndex]
      if (selected) onSelect(selected)
      return
    }
    if (keyName === "tab") {
      const selected = filteredItems[focusedIndex]
      if (!selected) return
      const tabAction = isShift ? (onShiftTab ?? onTab) : onTab
      if (tabAction) {
        tabAction.handler(selected)
      } else {
        onSelect(selected)
      }
      return
    }
    if (keyName === "escape" || (isCtrl && keyName === "c")) {
      onCancel()
      return
    }
    if (keyName === "backspace") {
      setQuery((q) => q.slice(0, -1))
      return
    }
    if (input) {
      setQuery((q) => q + input)
    }
  })

  const onQueryChangeRef = useRef(onQueryChange)
  useEffect(() => {
    onQueryChangeRef.current = onQueryChange
  }, [onQueryChange])

  useEffect(() => {
    onQueryChangeRef.current(query)
    setFocusedIndex(0)
  }, [query])

  useEffect(() => {
    setFocusedIndex((i) => Math.max(0, Math.min(i, filteredItems.length - 1)))
  }, [filteredItems.length])

  const focused = filteredItems[focusedIndex]

  const onFocusRef = useRef(onFocus)
  useEffect(() => {
    onFocusRef.current = onFocus
  }, [onFocus])

  useEffect(() => {
    if (onFocusRef.current) onFocusRef.current(focused)
  }, [focused])

  const windowStart = Math.max(0, Math.min(focusedIndex - visibleCount + 1, filteredItems.length - visibleCount))
  const visible = filteredItems.slice(windowStart, windowStart + visibleCount)
  const emptyText = typeof emptyMessage === "function" ? emptyMessage(query) : emptyMessage

  const searchBox = (
    <ThemedBox flexDirection="row" borderStyle="round" paddingX={1} borderColor="info">
      <Text dim>🔎 </Text>
      <Text>{query || <Text dim>{placeholder}</Text>}</Text>
      <Text>█</Text>
    </ThemedBox>
  )

  const listBlock =
    visible.length === 0 ? (
      <Box height={visibleCount} flexShrink={0}>
        <Text dim>{emptyText}</Text>
      </Box>
    ) : (
      <Box height={visibleCount} flexShrink={0} flexDirection={direction === "up" ? "column-reverse" : "column"}>
        {visible.map((item, i) => {
          const actualIndex = windowStart + i
          const isFocused = actualIndex === focusedIndex
          return (
            <Pane key={getKey(item)} color={isFocused ? "info" : undefined}>
              <Box flexDirection="row" paddingX={1}>
                <ThemedText color={isFocused ? "info" : undefined}>{isFocused ? "❯ " : "  "}</ThemedText>
                {renderItem(item, isFocused)}
              </Box>
            </Pane>
          )
        })}
      </Box>
    )

  const preview =
    renderPreview && focused ? (
      <Box flexDirection="column" flexGrow={1}>
        {renderPreview(focused)}
      </Box>
    ) : null

  const listGroup =
    renderPreview && previewPosition === "right" ? (
      <Box flexDirection="row" gap={2} height={visibleCount + (matchLabel ? 1 : 0)}>
        <Box flexDirection="column" flexShrink={0}>
          {listBlock}
          {matchLabel && <Text dim>{matchLabel}</Text>}
        </Box>
        {preview ?? <Box flexGrow={1} />}
      </Box>
    ) : (
      <Box flexDirection="column">
        {listBlock}
        {matchLabel && <Text dim>{matchLabel}</Text>}
        {preview}
      </Box>
    )

  const inputAbove = direction !== "up"
  const compact = false

  return (
    <Pane color="info">
      <Box flexDirection="column" gap={1}>
        <ThemedText bold color="info">
          {title}
        </ThemedText>
        {inputAbove && searchBox}
        {listGroup}
        {!inputAbove && searchBox}
        <Text dim>
          <Byline>
            <KeyboardShortcutHint shortcut="↑/↓" action={compact ? "nav" : "navigate"} />
            <KeyboardShortcutHint shortcut="Enter" action={selectAction} />
            {onTab && <KeyboardShortcutHint shortcut="Tab" action={onTab.action} />}
            {onShiftTab && !compact && <KeyboardShortcutHint shortcut="shift+tab" action={onShiftTab.action} />}
            <KeyboardShortcutHint shortcut="Esc" action="cancel" />
            {extraHints}
          </Byline>
        </Text>
      </Box>
    </Pane>
  )
}
