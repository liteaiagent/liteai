import type { Color, ScrollBoxHandle } from "@liteai/ink"
import { Box, ScrollBox, TerminalSizeContext, Text } from "@liteai/ink"
import React, { createContext, type ReactNode, type RefObject, useContext, useState, useSyncExternalStore } from "react"
import { ModalContext } from "../context/modal-context"
import { Toast } from "../ui/toast"
import { StickyPromptHeader } from "./sticky-prompt-header"
import { NewMessagesPill } from "./unseen-divider"

/** Rows of transcript context kept visible above the modal pane's ▔ divider. */
const MODAL_TRANSCRIPT_PEEK = 2

/** Context for scroll-derived chrome (sticky header, pill). */
export const ScrollChromeContext = createContext<{
  setStickyPrompt: (p: { text: string; scrollTo: () => void } | null) => void
}>({
  setStickyPrompt: () => {},
})

type Props = {
  /** Content that scrolls (messages, tool output) */
  scrollable: ReactNode
  /** Content pinned to the bottom (spinner, prompt, permissions) */
  bottom: ReactNode
  /** Content rendered inside the ScrollBox after messages */
  overlay?: ReactNode
  /** Absolute-positioned content anchored at the bottom-right */
  bottomFloat?: ReactNode
  /** Slash-command dialog content */
  modal?: ReactNode
  /** Ref passed via ModalContext */
  modalScrollRef?: RefObject<ScrollBoxHandle | null>
  /** Ref to the scroll box for keyboard scrolling */
  scrollRef?: RefObject<ScrollBoxHandle | null>
  /** Y-position of the unseen-divider */
  dividerYRef?: RefObject<number | null>
  /** Force-hide the pill */
  hidePill?: boolean
  /** Force-hide the sticky prompt header */
  hideSticky?: boolean
  /** Count for the pill text */
  newMessageCount?: number
  /** Called when the user clicks the "N new" pill */
  onPillClick?: () => void
}

/**
 * Layout wrapper for the session route.
 * 4-slot architecture: scrollable, bottom, overlay, modal.
 */
export function SessionLayout({
  scrollable,
  bottom,
  overlay,
  bottomFloat,
  modal,
  modalScrollRef,
  scrollRef,
  dividerYRef,
  hidePill = false,
  hideSticky = false,
  newMessageCount = 0,
  onPillClick,
}: Props) {
  const terminalSize = useContext(TerminalSizeContext)
  const terminalRows = terminalSize?.rows ?? 24
  const columns = terminalSize?.columns ?? 80

  const [stickyPrompt, setStickyPrompt] = useState<{ text: string; scrollTo: () => void } | null>(null)

  const chromeCtx = React.useMemo(() => ({ setStickyPrompt }), [])

  const subscribe = React.useCallback(
    (listener: () => void) => scrollRef?.current?.subscribe(listener) ?? (() => {}),
    [scrollRef],
  )

  const pillVisible = useSyncExternalStore(subscribe, () => {
    const s = scrollRef?.current
    const dividerY = dividerYRef?.current
    if (!s || dividerY == null) {
      return false
    }
    return s.getScrollTop() + s.getPendingDelta() + s.getViewportHeight() < dividerY
  })

  const sticky = hideSticky ? null : stickyPrompt
  const headerPrompt = sticky != null && overlay == null ? sticky : null
  const padCollapsed = sticky != null && overlay == null

  return (
    <>
      <Box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
        {headerPrompt && <StickyPromptHeader text={headerPrompt.text} onClick={headerPrompt.scrollTo} />}
        <ScrollBox
          ref={scrollRef}
          flexGrow={1}
          flexDirection="column"
          paddingTop={padCollapsed ? 0 : 1}
          stickyScroll={true}
        >
          <ScrollChromeContext.Provider value={chromeCtx}>{scrollable}</ScrollChromeContext.Provider>
          {overlay}
        </ScrollBox>
        {!hidePill && pillVisible && overlay == null && (
          <NewMessagesPill count={newMessageCount} onClick={onPillClick} />
        )}
        {bottomFloat != null && (
          <Box position="absolute" bottom={0} right={0} opaque={true}>
            {bottomFloat}
          </Box>
        )}
      </Box>
      <Box flexDirection="column" flexShrink={0} width="100%" maxHeight="50%">
        {/* TOAST OVERLAY ZONE (Absolute) — anchored just above the bottom bar */}
        <Box position="absolute" bottom="100%" left={0} right={0} opaque={true} flexDirection="column">
          <Toast />
        </Box>
        <Box flexDirection="column" width="100%" flexGrow={1} overflowY="hidden">
          {bottom}
        </Box>
      </Box>
      {modal != null && (
        <ModalContext.Provider
          value={{
            rows: terminalRows - MODAL_TRANSCRIPT_PEEK - 1,
            columns: columns - 4,
            scrollRef: modalScrollRef ?? null,
          }}
        >
          <Box
            position="absolute"
            bottom={0}
            left={0}
            right={0}
            height={terminalRows - MODAL_TRANSCRIPT_PEEK}
            flexDirection="column"
            overflow="hidden"
            opaque={true}
          >
            <Box flexShrink={0}>
              <Text color={"gray" as Color}>{"▔".repeat(columns)}</Text>
            </Box>
            <Box flexDirection="column" paddingX={2} flexGrow={1} overflowY="hidden">
              {modal}
            </Box>
          </Box>
        </ModalContext.Provider>
      )}
    </>
  )
}
