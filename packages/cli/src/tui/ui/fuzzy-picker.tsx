/** @jsxImportSource react */

import { Box, Text, useInput } from "@liteai/ink"
import type React from "react"
import { useEffect, useState } from "react"
import { Byline } from "../components/design-system/Byline"
import { KeyboardShortcutHint } from "../components/design-system/KeyboardShortcutHint"
import { Pane } from "../components/design-system/Pane"

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

  const step = (delta: 1 | -1) => {
    setFocusedIndex((i) => Math.max(0, Math.min(i + delta, items.length - 1)))
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
      const selected = items[focusedIndex]
      if (selected) onSelect(selected)
      return
    }
    if (keyName === "tab") {
      const selected = items[focusedIndex]
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

  useEffect(() => {
    onQueryChange(query)
    setFocusedIndex(0)
  }, [query, onQueryChange])

  useEffect(() => {
    setFocusedIndex((i) => Math.max(0, Math.min(i, items.length - 1)))
  }, [items.length])

  const focused = items[focusedIndex]
  useEffect(() => {
    if (onFocus) onFocus(focused)
  }, [focused, onFocus])

  const windowStart = Math.max(0, Math.min(focusedIndex - visibleCount + 1, items.length - visibleCount))
  const visible = items.slice(windowStart, windowStart + visibleCount)
  const emptyText = typeof emptyMessage === "function" ? emptyMessage(query) : emptyMessage

  const searchBox = (
    <Box flexDirection="row" borderStyle="round" paddingX={1} borderColor="ansi:blue">
      <Text dim>🔎 </Text>
      <Text>{query || <Text dim>{placeholder}</Text>}</Text>
      <Text>█</Text>
    </Box>
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
            <Pane key={getKey(item)} color={isFocused ? "ansi:blue" : undefined}>
              <Box flexDirection="row" paddingX={1}>
                <Text color={isFocused ? "ansi:blue" : undefined}>{isFocused ? "❯ " : "  "}</Text>
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
    <Pane color="ansi:blue">
      <Box flexDirection="column" gap={1}>
        <Text bold color="ansi:blue">
          {title}
        </Text>
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
