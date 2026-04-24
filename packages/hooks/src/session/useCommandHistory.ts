import { useCallback, useRef, useState } from 'react'
import type { CommandHistoryPorts, HistoryEntry, NotificationPort, PastedContent } from '../types.js'

export type HistoryMode = string

// Load history entries in chunks to reduce disk reads on rapid keypresses
const HISTORY_CHUNK_SIZE = 10

// Shared state for batching concurrent load requests into a single disk read
// Mode filter is included to ensure we don't mix filtered and unfiltered caches
let pendingLoad: Promise<HistoryEntry[]> | null = null
let pendingLoadTarget = 0
let pendingLoadModeFilter: HistoryMode | undefined

async function loadHistoryEntries(
  minCount: number,
  ports: CommandHistoryPorts,
  modeFilter?: HistoryMode,
): Promise<HistoryEntry[]> {
  // Round up to next chunk to avoid repeated small reads
  const target = Math.ceil(minCount / HISTORY_CHUNK_SIZE) * HISTORY_CHUNK_SIZE

  // If a load is already pending with the same mode filter and will satisfy our needs, wait for it
  if (pendingLoad && pendingLoadTarget >= target && pendingLoadModeFilter === modeFilter) {
    return pendingLoad
  }

  // If a load is pending but won't satisfy our needs or has different filter, we need to wait for it
  // to complete first, then start a new one (can't interrupt an ongoing read)
  if (pendingLoad) {
    await pendingLoad
  }

  // Start a new load
  pendingLoadTarget = target
  pendingLoadModeFilter = modeFilter
  pendingLoad = (async () => {
    const entries: HistoryEntry[] = []
    let loaded = 0
    for await (const entry of ports.getHistory()) {
      // If mode filter is specified, only include entries that match the mode
      if (modeFilter) {
        const entryMode = ports.getModeFromInput(entry.display)
        if (entryMode !== modeFilter) {
          continue
        }
      }
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
    pendingLoadModeFilter = undefined
  }
}

export interface CommandHistoryResult {
  historyIndex: number
  setHistoryIndex: (index: number) => void
  onHistoryUp: () => void
  onHistoryDown: () => boolean
  resetHistory: () => void
  dismissSearchHint: () => void
}

/**
 * Hook for managing command history navigation (Up/Down arrow).
 */
export function useCommandHistory(
  onSetInput: (value: string, mode: HistoryMode, pastedContents: Record<number, PastedContent>) => void,
  currentInput: string,
  pastedContents: Record<number, PastedContent>,
  ports: CommandHistoryPorts,
  notificationPort: NotificationPort,
  options: {
    setCursorOffset?: (offset: number) => void
    currentMode?: HistoryMode
    searchShortcutDisplay?: string
  } = {},
): CommandHistoryResult {
  const { setCursorOffset, currentMode, searchShortcutDisplay = 'ctrl+r' } = options
  const [historyIndex, setHistoryIndex] = useState(0)
  const [lastShownHistoryEntry, setLastShownHistoryEntry] = useState<
    | (HistoryEntry & {
        mode?: HistoryMode
      })
    | undefined
  >(undefined)
  const hasShownSearchHintRef = useRef(false)

  // Cache loaded history entries
  const historyCache = useRef<HistoryEntry[]>([])
  // Track which mode filter the cache was loaded with
  const historyCacheModeFilter = useRef<HistoryMode | undefined>(undefined)

  // Synchronous tracker for history index to avoid stale closure issues
  const historyIndexRef = useRef(0)

  // Track the mode filter that was active when history navigation started
  const initialModeFilterRef = useRef<HistoryMode | undefined>(undefined)

  // Refs to track current input values for draft preservation
  const currentInputRef = useRef(currentInput)
  const pastedContentsRef = useRef(pastedContents)
  const currentModeRef = useRef(currentMode)

  // Keep refs in sync with props
  currentInputRef.current = currentInput
  pastedContentsRef.current = pastedContents
  currentModeRef.current = currentMode

  const setInputWithCursor = useCallback(
    (value: string, mode: HistoryMode, contents: Record<number, PastedContent>, cursorToStart = false): void => {
      onSetInput(value, mode, contents)
      setCursorOffset?.(cursorToStart ? 0 : value.length)
    },
    [onSetInput, setCursorOffset],
  )

  const updateInput = useCallback(
    (input: HistoryEntry | undefined, cursorToStart = false): void => {
      if (!input || !input.display) return
      const mode = ports.getModeFromInput(input.display)
      // Strip mode character if it's a special mode (e.g. bash starting with !)
      const value = ports.getModeFromInput(input.display) === 'bash' ? input.display.slice(1) : input.display
      setInputWithCursor(value, mode, input.pastedContents ?? {}, cursorToStart)
    },
    [setInputWithCursor, ports],
  )

  const showSearchHint = useCallback((): void => {
    notificationPort.addNotification({
      key: 'search-history-hint',
      text: `Search history with ${searchShortcutDisplay}`,
      priority: 'immediate',
      timeoutMs: 5000,
    })
  }, [notificationPort, searchShortcutDisplay])

  const dismissSearchHint = useCallback((): void => {
    notificationPort.removeNotification('search-history-hint')
  }, [notificationPort])

  const onHistoryUp = useCallback((): void => {
    const targetIndex = historyIndexRef.current
    historyIndexRef.current++

    const inputAtPress = currentInputRef.current
    const pastedContentsAtPress = pastedContentsRef.current
    const modeAtPress = currentModeRef.current

    if (targetIndex === 0) {
      initialModeFilterRef.current = modeAtPress === 'bash' ? modeAtPress : undefined

      // Save draft
      const hasInput = inputAtPress.trim() !== ''
      setLastShownHistoryEntry(
        hasInput
          ? {
              display: inputAtPress,
              pastedContents: pastedContentsAtPress,
              mode: modeAtPress,
            }
          : undefined,
      )
    }

    const modeFilter = initialModeFilterRef.current

    void (async () => {
      const neededCount = targetIndex + 1

      // If mode filter changed, invalidate cache
      if (historyCacheModeFilter.current !== modeFilter) {
        historyCache.current = []
        historyCacheModeFilter.current = modeFilter
        historyIndexRef.current = 0
      }

      // Load more entries if needed
      if (historyCache.current.length < neededCount) {
        const entries = await loadHistoryEntries(neededCount, ports, modeFilter)
        if (entries.length > historyCache.current.length) {
          historyCache.current = entries
        }
      }

      // Check if we can navigate
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
        showSearchHint()
      }
    })()
  }, [updateInput, showSearchHint, ports])

  const onHistoryDown = useCallback((): boolean => {
    const currentIndex = historyIndexRef.current
    if (currentIndex > 1) {
      historyIndexRef.current--
      setHistoryIndex(currentIndex - 1)
      updateInput(historyCache.current[currentIndex - 2])
      return true
    } else if (currentIndex === 1) {
      historyIndexRef.current = 0
      setHistoryIndex(0)
      if (lastShownHistoryEntry) {
        const savedMode = lastShownHistoryEntry.mode
        if (savedMode) {
          setInputWithCursor(lastShownHistoryEntry.display, savedMode, lastShownHistoryEntry.pastedContents ?? {})
        } else {
          updateInput(lastShownHistoryEntry)
        }
      } else {
        onSetInput('', currentModeRef.current || 'prompt', {})
      }
      return true
    }
    return false
  }, [updateInput, lastShownHistoryEntry, onSetInput, setInputWithCursor])

  const resetHistory = useCallback((): void => {
    setHistoryIndex(0)
    historyIndexRef.current = 0
    initialModeFilterRef.current = undefined
    setLastShownHistoryEntry(undefined)
  }, [])

  return {
    historyIndex,
    setHistoryIndex,
    onHistoryUp,
    onHistoryDown,
    resetHistory,
    dismissSearchHint,
  }
}
