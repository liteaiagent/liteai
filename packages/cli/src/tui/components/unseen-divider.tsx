import type { Color, ScrollBoxHandle } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type { Message } from "@liteai/sdk"
import figures from "figures"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTheme } from "../context/theme"

export function useUnseenDivider(messageCount: number): {
  dividerIndex: number | null
  dividerYRef: React.RefObject<number | null>
  onScrollAway: (handle: ScrollBoxHandle) => void
  onRepin: () => void
  jumpToNew: (handle: ScrollBoxHandle | null) => void
  shiftDivider: (indexDelta: number, heightDelta: number) => void
} {
  const [dividerIndex, setDividerIndex] = useState<number | null>(null)
  const countRef = useRef(messageCount)
  countRef.current = messageCount

  const dividerYRef = useRef<number | null>(null)

  const onRepin = useCallback(() => {
    setDividerIndex(null)
  }, [])

  const onScrollAway = useCallback((handle: ScrollBoxHandle) => {
    const max = Math.max(0, handle.getScrollHeight() - handle.getViewportHeight())
    if (handle.getScrollTop() + handle.getPendingDelta() >= max) return

    if (dividerYRef.current === null) {
      dividerYRef.current = handle.getScrollHeight()
      setDividerIndex(countRef.current)
    }
  }, [])

  const jumpToNew = useCallback((handle: ScrollBoxHandle | null) => {
    if (!handle) return
    handle.scrollToBottom()
  }, [])

  useEffect(() => {
    if (dividerIndex === null) {
      dividerYRef.current = null
    } else if (messageCount < dividerIndex) {
      dividerYRef.current = null
      setDividerIndex(null)
    }
  }, [messageCount, dividerIndex])

  const shiftDivider = useCallback((indexDelta: number, heightDelta: number) => {
    setDividerIndex((idx) => (idx === null ? null : idx + indexDelta))
    if (dividerYRef.current !== null) {
      dividerYRef.current += heightDelta
    }
  }, [])

  return {
    dividerIndex,
    dividerYRef,
    onScrollAway,
    onRepin,
    jumpToNew,
    shiftDivider,
  }
}

export function countUnseenAssistantTurns(messages: Message[], dividerIndex: number): number {
  let count = 0
  let prevWasAssistant = false
  for (let i = dividerIndex; i < messages.length; i++) {
    const m = messages[i]
    if (!m) continue

    const isAssistant = m.role === "assistant"
    if (isAssistant && !prevWasAssistant) count++
    prevWasAssistant = isAssistant
  }
  return count
}

export type UnseenDivider = {
  firstUnseenUuid: string
  count: number
}

export function computeUnseenDivider(messages: Message[], dividerIndex: number | null): UnseenDivider | undefined {
  if (dividerIndex === null) return undefined

  const anchorIdx = dividerIndex
  const uuid = messages[anchorIdx]?.id
  if (!uuid) return undefined

  const count = countUnseenAssistantTurns(messages, dividerIndex)
  return {
    firstUnseenUuid: uuid,
    count: Math.max(1, count),
  }
}

export function NewMessagesPill({ count, onClick }: { count: number; onClick?: () => void }) {
  const [hover, setHover] = useState(false)
  const { theme } = useTheme()

  const bgColor = (hover ? theme.backgroundPanel : theme.backgroundElement) as Color
  const text = count > 0 ? `${count} new message${count === 1 ? "" : "s"}` : "Jump to bottom"

  return (
    <Box position="absolute" bottom={0} left={0} right={0} justifyContent="center">
      <Box onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <Text backgroundColor={bgColor} color={theme.textMuted as Color}>
          {" "}
          {text} {figures.arrowDown}{" "}
        </Text>
      </Box>
    </Box>
  )
}
