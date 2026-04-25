/**
 * useArrowKeyHistory hook
 *
 * Manages history navigation via up/down arrow keys with chunk-based
 * lazy loading, draft preservation, and rapid-keypress handling.
 *
 * Ported from MVP useArrowKeyHistory.tsx. Dependency remappings:
 * - getHistory → injected loadEntries async generator
 * - getModeFromInput → deferred (always "prompt" mode)
 * - useNotifications → injected showSearchHint callback
 * - PastedContent/HistoryEntry → simplified HistoryEntry type
 */

import { useCallback, useRef, useState } from "react"
import type { PromptInputMode } from "../types/text-input"

export type HistoryMode = PromptInputMode

/**
 * A single history entry. Minimal contract — the concrete loader
 * decides what fields to populate.
 */
export type HistoryEntry = {
  readonly display: string
  readonly pastedContents?: Record<number, unknown>
}

// Load history entries in chunks to reduce disk reads on rapid keypresses
const HISTORY_CHUNK_SIZE = 10

// Shared state for batching concurrent load requests into a single disk read
let pendingLoad: Promise<HistoryEntry[]> | null = null
let pendingLoadTarget = 0

export type UseArrowKeyHistoryProps = {
  /** Setter for the prompt value + cursor position */
  onSetInput: (value: string) => void
  /** Current prompt value */
  currentInput: string
  /** Setter for cursor offset within the input */
  setCursorOffset?: (offset: number) => void
  /** Async generator that yields history entries (most recent first) */
  loadEntries: () => AsyncIterable<HistoryEntry>
  /** Optional callback to show "search history" hint toast */
  showSearchHint?: () => void
  /** Optional callback to dismiss the search hint */
  dismissSearchHint?: () => void
}

export type UseArrowKeyHistoryResult = {
  historyIndex: number
  setHistoryIndex: (index: number) => void
  onHistoryUp: () => void
  onHistoryDown: () => boolean
  resetHistory: () => void
  dismissSearchHint: () => void
}

async function loadHistoryEntries(
  loader: () => AsyncIterable<HistoryEntry>,
  minCount: number,
): Promise<HistoryEntry[]> {
  const target = Math.ceil(minCount / HISTORY_CHUNK_SIZE) * HISTORY_CHUNK_SIZE

  if (pendingLoad && pendingLoadTarget >= target) {
    return pendingLoad
  }

  if (pendingLoad) {
    await pendingLoad
  }

  pendingLoadTarget = target
  pendingLoad = (async () => {
    const entries: HistoryEntry[] = []
    let loaded = 0
    for await (const entry of loader()) {
      entries.push(entry)
      loaded++
      if (loaded >= pendingLoadTarget) break
    }
    return entries
  })()

  try {
    return await pendingLoad
  } finally {
    pendingLoad = null
    pendingLoadTarget = 0
  }
}

export function useArrowKeyHistory({
  onSetInput,
  currentInput,
  setCursorOffset,
  loadEntries,
  showSearchHint: showSearchHintCallback,
  dismissSearchHint: dismissSearchHintCallback,
}: UseArrowKeyHistoryProps): UseArrowKeyHistoryResult {
  const [historyIndex, setHistoryIndex] = useState(0)
  const [lastShownHistoryEntry, setLastShownHistoryEntry] = useState<HistoryEntry | undefined>(undefined)
  const hasShownSearchHintRef = useRef(false)

  // Cache loaded history entries
  const historyCache = useRef<HistoryEntry[]>([])

  // Synchronous tracker for history index to avoid stale closure issues
  const historyIndexRef = useRef(0)

  // Ref to track current input value for draft preservation
  const currentInputRef = useRef(currentInput)
  currentInputRef.current = currentInput

  const setInputWithCursor = useCallback(
    (value: string, cursorToStart = false): void => {
      onSetInput(value)
      setCursorOffset?.(cursorToStart ? 0 : value.length)
    },
    [onSetInput, setCursorOffset],
  )

  const updateInput = useCallback(
    (input: HistoryEntry | undefined, cursorToStart = false): void => {
      if (!input?.display) return
      setInputWithCursor(input.display, cursorToStart)
    },
    [setInputWithCursor],
  )

  const onHistoryUp = useCallback((): void => {
    const targetIndex = historyIndexRef.current
    historyIndexRef.current++

    const inputAtPress = currentInputRef.current

    if (targetIndex === 0) {
      const hasInput = inputAtPress.trim() !== ""
      setLastShownHistoryEntry(hasInput ? { display: inputAtPress } : undefined)
    }

    void (async () => {
      const neededCount = targetIndex + 1

      if (historyCache.current.length < neededCount) {
        const entries = await loadHistoryEntries(loadEntries, neededCount)
        if (entries.length > historyCache.current.length) {
          historyCache.current = entries
        }
      }

      if (targetIndex >= historyCache.current.length) {
        historyIndexRef.current--
        return
      }

      const newIndex = targetIndex + 1
      setHistoryIndex(newIndex)
      updateInput(historyCache.current[targetIndex], true)

      // Show hint once per session after navigating through 2 history entries
      if (newIndex >= 2 && !hasShownSearchHintRef.current) {
        hasShownSearchHintRef.current = true
        showSearchHintCallback?.()
      }
    })()
  }, [updateInput, showSearchHintCallback, loadEntries])

  const onHistoryDown = useCallback((): boolean => {
    const currentIndex = historyIndexRef.current
    if (currentIndex > 1) {
      historyIndexRef.current--
      setHistoryIndex(currentIndex - 1)
      updateInput(historyCache.current[currentIndex - 2])
    } else if (currentIndex === 1) {
      historyIndexRef.current = 0
      setHistoryIndex(0)
      if (lastShownHistoryEntry) {
        setInputWithCursor(lastShownHistoryEntry.display)
      } else {
        setInputWithCursor("")
      }
    }
    return currentIndex <= 0
  }, [lastShownHistoryEntry, updateInput, setInputWithCursor])

  const resetHistory = useCallback((): void => {
    setLastShownHistoryEntry(undefined)
    setHistoryIndex(0)
    historyIndexRef.current = 0
    dismissSearchHintCallback?.()
    historyCache.current = []
  }, [dismissSearchHintCallback])

  const dismissSearchHint = useCallback((): void => {
    dismissSearchHintCallback?.()
  }, [dismissSearchHintCallback])

  return {
    historyIndex,
    setHistoryIndex,
    onHistoryUp,
    onHistoryDown,
    resetHistory,
    dismissSearchHint,
  }
}
