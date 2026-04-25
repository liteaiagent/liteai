import type { Color, DOMElement, ScrollBoxHandle } from "@liteai/ink"
import { Box } from "@liteai/ink"
import type { Message, Part, TextPart } from "@liteai/sdk"
import type React from "react"
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useVirtualScroll } from "../../tui/hooks/use-virtual-scroll"
import { useSync } from "../context/sync"
import { ScrollChromeContext } from "./session-layout"

export type StickyPrompt = {
  text: string
  scrollTo: () => void
}

const STICKY_TEXT_CAP = 500

type Props = {
  messages: Message[]
  scrollRef: React.RefObject<ScrollBoxHandle | null>
  columns: number
  itemKey: (msg: Message) => string
  renderItem: (msg: Message, index: number) => React.ReactNode
  onItemClick?: (msg: Message) => void
  isItemClickable?: (msg: Message) => boolean
  isItemExpanded?: (msg: Message) => boolean
  trackStickyPrompt?: boolean
  selectedIndex?: number
}

function promptTextFromMessage(msg: Message, parts: Part[]): string | null {
  if (msg.role !== "user") return null
  const block = parts.find((p) => p.type === "text" && !(p as TextPart).synthetic && !(p as TextPart).ignored) as
    | TextPart
    | undefined
  if (!block || block.type !== "text") return null
  const text = block.text.trim()
  if (!text || text.startsWith("<")) return null
  return text
}

type VirtualItemProps = {
  key?: string
  itemKey: string
  msg: Message
  idx: number
  measureRef: (key: string) => (el: DOMElement | null) => void
  expanded: boolean | undefined
  hovered: boolean
  clickable: boolean
  onClickK: (msg: Message, cellIsBlank: boolean) => void
  onEnterK: (k: string) => void
  onLeaveK: (k: string) => void
  renderItem: (msg: Message, idx: number) => React.ReactNode
}

function VirtualItem({
  itemKey: k,
  msg,
  idx,
  measureRef,
  expanded,
  hovered,
  clickable,
  onClickK,
  onEnterK,
  onLeaveK,
  renderItem,
}: VirtualItemProps) {
  const ref = measureRef(k)

  const bg = expanded || hovered ? "backgroundPanel" : undefined
  const pb = expanded ? 1 : undefined

  const onClick = clickable ? () => onClickK(msg, false) : undefined
  const onEnter = clickable ? () => onEnterK(k) : undefined
  const onLeave = clickable ? () => onLeaveK(k) : undefined

  const rendered = renderItem(msg, idx)

  return (
    <Box
      ref={ref}
      flexDirection="column"
      backgroundColor={bg as Color}
      paddingBottom={pb}
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {rendered}
    </Box>
  )
}

export function VirtualMessageList({
  messages,
  scrollRef,
  columns,
  itemKey,
  renderItem,
  onItemClick,
  isItemClickable,
  isItemExpanded,
  trackStickyPrompt,
  selectedIndex,
}: Props) {
  const keysRef = useRef<string[]>([])
  const prevMessagesRef = useRef<typeof messages>(messages)
  const prevItemKeyRef = useRef(itemKey)

  if (
    prevItemKeyRef.current !== itemKey ||
    messages.length < keysRef.current.length ||
    messages[0] !== prevMessagesRef.current[0]
  ) {
    keysRef.current = messages.map((m) => itemKey(m))
  } else {
    for (let i = keysRef.current.length; i < messages.length; i++) {
      const m = messages[i]
      if (m) keysRef.current.push(itemKey(m))
    }
  }

  prevMessagesRef.current = messages
  prevItemKeyRef.current = itemKey
  const keys = keysRef.current

  const { range, topSpacer, bottomSpacer, measureRef, spacerRef, offsets, getItemTop, getItemElement, scrollToIndex } =
    useVirtualScroll(scrollRef, keys, columns)

  const [start, end] = range

  const jumpState = useRef({
    offsets,
    start,
    getItemElement,
    getItemTop,
    messages,
    scrollToIndex,
  })
  jumpState.current = {
    offsets,
    start,
    getItemElement,
    getItemTop,
    messages,
    scrollToIndex,
  }

  useEffect(() => {
    if (selectedIndex === undefined) return
    const s = jumpState.current
    const el = s.getItemElement(selectedIndex)
    if (el) {
      scrollRef.current?.scrollToElement(el, 1)
    } else {
      s.scrollToIndex(selectedIndex)
    }
  }, [selectedIndex, scrollRef])

  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const handlersRef = useRef({
    onItemClick,
    setHoveredKey,
  })
  handlersRef.current = {
    onItemClick,
    setHoveredKey,
  }

  const onClickK = useCallback((msg: Message, cellIsBlank: boolean) => {
    const h = handlersRef.current
    if (!cellIsBlank && h.onItemClick) h.onItemClick(msg)
  }, [])

  const onEnterK = useCallback((k: string) => {
    handlersRef.current.setHoveredKey(k)
  }, [])

  const onLeaveK = useCallback((k: string) => {
    handlersRef.current.setHoveredKey((prev) => (prev === k ? null : prev))
  }, [])

  return (
    <>
      <Box ref={spacerRef} height={topSpacer} flexShrink={0} />
      {messages.slice(start, end).map((msg, i) => {
        const idx = start + i
        const k = keys[idx]
        if (!k) return null
        const clickable = !!onItemClick && (isItemClickable?.(msg) ?? true)
        const hovered = clickable && hoveredKey === k
        const expanded = isItemExpanded?.(msg)
        return (
          <VirtualItem
            key={k}
            itemKey={k}
            msg={msg}
            idx={idx}
            measureRef={measureRef}
            expanded={expanded}
            hovered={hovered}
            clickable={clickable}
            onClickK={onClickK}
            onEnterK={onEnterK}
            onLeaveK={onLeaveK}
            renderItem={renderItem}
          />
        )
      })}
      {bottomSpacer > 0 && <Box height={bottomSpacer} flexShrink={0} />}
      {trackStickyPrompt && (
        <StickyTracker
          messages={messages}
          start={start}
          end={end}
          offsets={offsets}
          getItemTop={getItemTop}
          getItemElement={getItemElement}
          scrollRef={scrollRef}
        />
      )}
    </>
  )
}

const NOOP_UNSUB = () => {}

function StickyTracker({
  messages,
  start,
  end,
  offsets,
  getItemTop,
  getItemElement,
  scrollRef,
}: {
  messages: Message[]
  start: number
  end: number
  offsets: ArrayLike<number>
  getItemTop: (index: number) => number
  getItemElement: (index: number) => DOMElement | null
  scrollRef: React.RefObject<ScrollBoxHandle | null>
}): null {
  const sync = useSync()
  const { setStickyPrompt } = useContext(ScrollChromeContext)
  const subscribe = useCallback(
    (listener: () => void) => scrollRef.current?.subscribe(listener) ?? NOOP_UNSUB,
    [scrollRef],
  )

  useSyncExternalStore(subscribe, () => {
    const s = scrollRef.current
    if (!s) return NaN
    const t = s.getScrollTop() + s.getPendingDelta()
    return s.isSticky() ? -1 - t : t
  })

  const isSticky = scrollRef.current?.isSticky() ?? true
  const target = Math.max(0, (scrollRef.current?.getScrollTop() ?? 0) + (scrollRef.current?.getPendingDelta() ?? 0))

  let firstVisible = start
  let firstVisibleTop = -1
  for (let i = end - 1; i >= start; i--) {
    const top = getItemTop(i)
    if (top >= 0) {
      if (top < target) break
      firstVisibleTop = top
    }
    firstVisible = i
  }

  let idx = -1
  let text: string | null = null
  if (firstVisible > 0 && !isSticky) {
    for (let i = firstVisible - 1; i >= 0; i--) {
      const msg = messages[i]
      if (!msg) continue
      const parts = sync.part[msg.id] ?? []
      const t = promptTextFromMessage(msg, parts)
      if (t === null) continue
      const top = getItemTop(i)
      if (top >= 0 && top + 1 >= target) continue
      idx = i
      text = t
      break
    }
  }

  const baseOffset = firstVisibleTop >= 0 ? firstVisibleTop - (offsets[firstVisible] ?? 0) : 0
  const estimate = idx >= 0 ? Math.max(0, baseOffset + (offsets[idx] ?? 0)) : -1

  const pending = useRef({ idx: -1, tries: 0 })
  type Suppress = "none" | "armed" | "force"
  const suppress = useRef<Suppress>("none")
  const lastIdx = useRef(-1)

  useEffect(() => {
    if (pending.current.idx >= 0) return
    if (suppress.current === "armed") {
      suppress.current = "force"
      return
    }

    const force = suppress.current === "force"
    suppress.current = "none"

    if (!force && lastIdx.current === idx) return
    lastIdx.current = idx

    if (text === null) {
      setStickyPrompt(null)
      return
    }

    const trimmed = text.trimStart()
    const paraEnd = trimmed.search(/\n\s*\n/)
    const collapsed = (paraEnd >= 0 ? trimmed.slice(0, paraEnd) : trimmed)
      .slice(0, STICKY_TEXT_CAP)
      .replace(/\s+/g, " ")
      .trim()

    if (collapsed === "") {
      setStickyPrompt(null)
      return
    }

    const capturedIdx = idx
    const capturedEstimate = estimate

    setStickyPrompt({
      text: collapsed,
      scrollTo: () => {
        setStickyPrompt(null) // "clicked" hack not needed if we clear
        suppress.current = "armed"
        const el = getItemElement(capturedIdx)
        if (el) {
          scrollRef.current?.scrollToElement(el, 1)
        } else {
          scrollRef.current?.scrollTo(capturedEstimate)
          pending.current = { idx: capturedIdx, tries: 0 }
        }
      },
    })
  })

  useEffect(() => {
    if (pending.current.idx < 0) return
    const el = getItemElement(pending.current.idx)
    if (el) {
      scrollRef.current?.scrollToElement(el, 1)
      pending.current = { idx: -1, tries: 0 }
    } else if (++pending.current.tries > 5) {
      pending.current = { idx: -1, tries: 0 }
    }
  })

  return null
}
