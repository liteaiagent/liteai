import type { Message, Part } from "@liteai/sdk"
import { useCallback, useMemo, useState } from "react"

/** Which message types can be navigated to */
export type NavigableRole = "user" | "assistant"

/** Cursor state exposed to consumers */
export type MessageCursorState = {
  /** Whether cursor mode is active */
  active: boolean
  /** Index into the messages array, undefined when inactive */
  selectedIndex: number | undefined
  /** The selected message (derived) */
  selectedMessage: Message | undefined
  /** Per-message and per-part expand/collapse state */
  expandedIds: ReadonlySet<string>
}

/** Navigation + action dispatch interface */
export type MessageCursorActions = {
  /** Enter cursor mode, selecting the last navigable message */
  enterCursor: () => void
  /** Exit cursor mode */
  exit: () => void
  /** Navigate to previous navigable message */
  moveUp: () => void
  /** Navigate to next navigable message; if past end, exit cursor */
  moveDown: () => void
  /** Jump to first navigable message */
  moveToTop: () => void
  /** Jump to last navigable message */
  moveToBottom: () => void
  /** Toggle expand/collapse for a specific id or the selected message */
  toggleExpand: (id?: string) => void
}

export type UseMessageCursorReturn = MessageCursorState & MessageCursorActions

/**
 * Filter function to determine if a message should be navigable via cursor.
 */
export function isNavigable(msg: Message, parts: Part[]): boolean {
  if (msg.role === "user") {
    // User messages are navigable if they have a non-empty text part that isn't ignored/synthetic
    return parts.some((p) => p.type === "text" && !p.synthetic && !p.ignored && p.text.trim().length > 0)
  }

  if (msg.role === "assistant") {
    // Assistant messages are navigable if they have an error, text part, or tool calls
    if (msg.error && msg.error.name !== "MessageAbortedError") return true
    if (parts.some((p) => p.type === "text" && p.text.trim().length > 0)) return true
    if (parts.some((p) => p.type === "tool")) return true
    if (parts.some((p) => p.type === "reasoning")) return true
  }

  return false
}

export function useMessageCursor(messages: Message[], partsMap: Record<string, Part[]>): UseMessageCursorReturn {
  const [active, setActive] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | undefined>(undefined)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Compute indices of messages that can be navigated to
  const navigableIndices = useMemo(() => {
    const indices: number[] = []
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (!msg) continue
      const parts = partsMap[msg.id] ?? []
      if (isNavigable(msg, parts)) {
        indices.push(i)
      }
    }
    return indices
  }, [messages, partsMap])

  const selectedMessage = selectedIndex !== undefined ? messages[selectedIndex] : undefined

  const enterCursor = useCallback(() => {
    if (navigableIndices.length === 0) return
    setActive(true)
    setSelectedIndex(navigableIndices[navigableIndices.length - 1])
  }, [navigableIndices])

  const exit = useCallback(() => {
    setActive(false)
    setSelectedIndex(undefined)
  }, [])

  const moveUp = useCallback(() => {
    if (navigableIndices.length === 0) return
    if (selectedIndex === undefined) {
      enterCursor()
      return
    }

    const currentNavIndex = navigableIndices.indexOf(selectedIndex)
    if (currentNavIndex === -1) {
      // Current selected is no longer navigable, try to recover by finding closest
      const closest = navigableIndices
        .slice()
        .reverse()
        .find((i) => i < selectedIndex)
      if (closest !== undefined) setSelectedIndex(closest)
      else setSelectedIndex(navigableIndices[0])
      return
    }

    if (currentNavIndex > 0) {
      setSelectedIndex(navigableIndices[currentNavIndex - 1])
    }
  }, [navigableIndices, selectedIndex, enterCursor])

  const moveDown = useCallback(() => {
    if (navigableIndices.length === 0) return
    if (selectedIndex === undefined) {
      enterCursor()
      return
    }

    const currentNavIndex = navigableIndices.indexOf(selectedIndex)
    if (currentNavIndex === -1) {
      // Current selected is no longer navigable, try to recover by finding closest
      const closest = navigableIndices.find((i) => i > selectedIndex)
      if (closest !== undefined) setSelectedIndex(closest)
      else exit()
      return
    }

    if (currentNavIndex < navigableIndices.length - 1) {
      setSelectedIndex(navigableIndices[currentNavIndex + 1])
    } else {
      // Past the end -> exit cursor mode back to prompt
      exit()
    }
  }, [navigableIndices, selectedIndex, enterCursor, exit])

  const moveToTop = useCallback(() => {
    if (navigableIndices.length === 0) return
    setActive(true)
    setSelectedIndex(navigableIndices[0])
  }, [navigableIndices])

  const moveToBottom = useCallback(() => {
    if (navigableIndices.length === 0) return
    setActive(true)
    setSelectedIndex(navigableIndices[navigableIndices.length - 1])
  }, [navigableIndices])

  const toggleExpand = useCallback(
    (id?: string) => {
      const targetId = id ?? selectedMessage?.id
      if (!targetId) return

      setExpandedIds((prev) => {
        const next = new Set(prev)
        if (next.has(targetId)) {
          next.delete(targetId)
        } else {
          next.add(targetId)
        }
        return next
      })
    },
    [selectedMessage],
  )

  return {
    active,
    selectedIndex,
    selectedMessage,
    expandedIds,
    enterCursor,
    exit,
    moveUp,
    moveDown,
    moveToTop,
    moveToBottom,
    toggleExpand,
  }
}
