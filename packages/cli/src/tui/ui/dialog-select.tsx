import type { Color } from "@liteai/ink"
import { Box, TerminalSizeContext, Text } from "@liteai/ink"
import fuzzysort from "fuzzysort"
import type React from "react"
import { useContext, useEffect, useImperativeHandle, useMemo, useState } from "react"
import { TextInput } from "../components/text-input"
import type { DialogContextType } from "../context/dialog"
import { useDialog } from "../context/dialog"
import { useTheme } from "../context/theme"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"

export interface DialogSelectOption<T = unknown> {
  title: string
  value: T
  description?: string
  footer?: React.ReactNode | string
  category?: string
  disabled?: boolean
  bg?: string
  gutter?: React.ReactNode
  onSelect?: (ctx: DialogContextType) => void
}

export type DialogSelectRef<T> = {
  filter: string
  filtered: DialogSelectOption<T>[]
}

export interface DialogSelectProps<T> {
  title: string
  placeholder?: string
  options: DialogSelectOption<T>[]
  flat?: boolean
  ref?: React.Ref<DialogSelectRef<T>>
  onMove?: (option: DialogSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: DialogSelectOption<T>) => void
  skipFilter?: boolean

  current?: T
  header?: React.ReactNode
  headerEnd?: React.ReactNode
  footerContent?: React.ReactNode
  /** When provided, called on Escape instead of dialog.clear(). Enables stacked dialog pop navigation. */
  onEscape?: () => void
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  const { theme } = useTheme()
  const dialog = useDialog()
  useRegisterKeybindingContext("Select")
  const terminalSize = useContext(TerminalSizeContext)

  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Filtering
  const filtered = useMemo(() => {
    if (props.skipFilter) {
      return props.options.filter((x) => !x.disabled)
    }
    const needle = query.toLowerCase()
    const validOptions = props.options.filter((x) => !x.disabled)

    if (!needle) return validOptions

    const results = fuzzysort.go(needle, validOptions, {
      keys: ["title", "category"],
      scoreFn: (r) => (r[0] ? r[0].score * 2 : 0) + (r[1] ? r[1].score : 0),
    })

    return results.map((x) => x.obj)
  }, [props.options, query, props.skipFilter])

  // Flat vs grouped
  const flatten = props.flat && query.length > 0

  const grouped = useMemo(() => {
    if (flatten) return [["", filtered]] as [string, DialogSelectOption<T>[]][]

    const groups: Record<string, DialogSelectOption<T>[]> = {}
    for (const opt of filtered) {
      const cat = opt.category ?? ""
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(opt)
    }

    return Object.entries(groups)
  }, [filtered, flatten])

  const flatOptions = useMemo(() => {
    return grouped.flatMap(([, options]) => options)
  }, [grouped])

  // Maintain selection on filter/props change
  useEffect(() => {
    if (flatOptions.length === 0) return

    // If current is set and we just mounted/updated, try to select it
    if (props.current !== undefined) {
      const idx = flatOptions.findIndex((o) => {
        // Deep equal isn't strictly available in React out of the box, we use JSON or strict
        // SolidJS used remeda's isDeepEqual. We'll do a simple fallback.
        try {
          return JSON.stringify(o.value) === JSON.stringify(props.current)
        } catch {
          return o.value === props.current
        }
      })
      if (idx >= 0) {
        setSelectedIndex(idx)
        return
      }
    }

    // Clamp selection
    setSelectedIndex((prev) => Math.max(0, Math.min(prev, flatOptions.length - 1)))
  }, [flatOptions, props.current])

  // Fire onFilter
  useEffect(() => {
    props.onFilter?.(query)
  }, [query, props.onFilter])

  // Fire onMove
  const selectedOption = flatOptions[selectedIndex]
  useEffect(() => {
    if (selectedOption && props.onMove) {
      props.onMove(selectedOption)
    }
  }, [selectedOption, props.onMove])

  useImperativeHandle(props.ref, () => ({
    get filter() {
      return query
    },
    get filtered() {
      return filtered
    },
  }))

  const move = (delta: number) => {
    if (flatOptions.length === 0) return
    setSelectedIndex((prev) => {
      let next = prev + delta
      if (next < 0) next = flatOptions.length - 1
      if (next >= flatOptions.length) next = 0
      return next
    })
  }

  useKeybindings(
    {
      "select:previous": () => move(-1),
      "select:next": () => move(1),
      "select:pageUp": () => move(-10),
      "select:pageDown": () => move(10),
      "select:home": () => setSelectedIndex(0),
      "select:end": () => setSelectedIndex(flatOptions.length - 1),
      "select:accept": () => {
        if (selectedOption && !selectedOption.disabled) {
          selectedOption.onSelect?.(dialog)
          props.onSelect?.(selectedOption)
        }
      },
      "select:cancel": () => {
        if (props.onEscape) {
          props.onEscape()
        } else {
          dialog.clear()
        }
      },
    },
    { context: "Select" },
  )

  // Slicing logic for scrolling
  const terminalHeight = terminalSize?.rows || 24
  const maxListHeight = Math.floor(terminalHeight / 2) - 6

  // To do a sliding window, we need to map flatOptions back to their rendered rows
  // In a terminal, each header takes 1 line, each item takes 1 line.
  // We'll construct a linear array of renderables to slice.
  const renderRows: React.ReactNode[] = []
  let itemIndex = 0
  let selectedRowIndex = 0

  grouped.forEach(([category, options], groupIndex) => {
    if (category) {
      renderRows.push(
        <Box key={`cat-${category}`} paddingTop={groupIndex > 0 ? 1 : 0} paddingLeft={3}>
          <Text color={theme.accent as Color} bold>
            {category}
          </Text>
        </Box>,
      )
    }
    options.forEach((option) => {
      const isActive = itemIndex === selectedIndex
      const isCurrent = (() => {
        try {
          return JSON.stringify(option.value) === JSON.stringify(props.current)
        } catch {
          return option.value === props.current
        }
      })()

      if (isActive) {
        selectedRowIndex = renderRows.length
      }

      renderRows.push(
        <Box
          key={`opt-${itemIndex}`}
          flexDirection="row"
          paddingLeft={isCurrent || option.gutter ? 1 : 3}
          paddingRight={3}
          gap={1}
          backgroundColor={isActive ? ((option.bg ?? theme.primary) as Color) : undefined}
        >
          {isCurrent && <Text color={isActive ? (theme.background as Color) : (theme.primary as Color)}>●</Text>}
          {!isCurrent && option.gutter && <Box flexShrink={0}>{option.gutter}</Box>}
          <Text bold={isActive} color={(isActive ? theme.background : isCurrent ? theme.primary : theme.text) as Color}>
            {option.title}
          </Text>
          {option.description && option.description !== category && (
            <Text color={(isActive ? theme.background : theme.textMuted) as Color}> {option.description}</Text>
          )}
          {option.footer && (
            <Box flexShrink={0} marginLeft={1}>
              {typeof option.footer === "string" ? (
                <Text color={(isActive ? theme.background : theme.textMuted) as Color}>{option.footer}</Text>
              ) : (
                option.footer
              )}
            </Box>
          )}
        </Box>,
      )
      itemIndex++
    })
  })

  // Window bounds
  const windowStart = Math.max(
    0,
    Math.min(selectedRowIndex - Math.floor(maxListHeight / 2), renderRows.length - maxListHeight),
  )
  const visibleRows = renderRows.slice(windowStart, windowStart + maxListHeight)

  return (
    <Box flexDirection="column" gap={1} paddingBottom={1}>
      {/* Header section */}
      <Box paddingLeft={4} paddingRight={4} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={2}>
            <Text color={theme.text as Color} bold>
              {props.title}
            </Text>
            {props.headerEnd}
          </Box>
          <Text color={theme.textMuted as Color}>esc</Text>
        </Box>
        <Box paddingTop={1}>
          <Box borderStyle="round" paddingX={1} borderColor="ansi:blue" width="100%">
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder={props.placeholder ?? "Search"}
              disableCursorMovementForUpDownKeys={true}
              disableEscapeDoublePress={true}
              focus={true}
            />
          </Box>
        </Box>
      </Box>

      {/* Optional custom header */}
      {props.header && (
        <Box paddingLeft={4} paddingRight={4} paddingTop={1} paddingBottom={1}>
          {props.header}
        </Box>
      )}

      {/* List */}
      {renderRows.length > 0 ? (
        <Box
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
          height={Math.min(renderRows.length, maxListHeight)}
        >
          {visibleRows}
        </Box>
      ) : (
        <Box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <Text color={theme.textMuted as Color}>No results found</Text>
        </Box>
      )}

      {props.footerContent && (
        <Box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
          {props.footerContent}
        </Box>
      )}
    </Box>
  )
}
