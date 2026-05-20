import { useApp } from "@liteai/ink"
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import { win32FlushInputBuffer } from "../../cli/cmd/tui/win32"
import { FormatError, FormatUnknownError } from "../../cli/error"
import { type ExitSummaryData, formatExitSummary } from "../util/exit-summary"
export type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
  stats: {
    set: (value: ExitSummaryData) => void
  }
}

const ExitContext = createContext<Exit | undefined>(undefined)

export function useExit(): Exit {
  const context = useContext(ExitContext)
  if (context === undefined) {
    throw new Error("Exit context must be used within a context provider")
  }
  return context
}

export function ExitProvider({ children, onExit }: { children?: React.ReactNode; onExit?: () => Promise<void> }) {
  const { exit: inkExit } = useApp()
  const [message, setMessage] = useState<string | undefined>()

  // Synchronous ref guard prevents double-exit races that useState cannot catch
  const exitingRef = useRef(false)
  // Keep message in a ref so the exit callback reads the latest value
  const messageRef = useRef<string | undefined>(undefined)
  messageRef.current = message
  // Stats snapshot for exit summary — set by session components before exit
  const statsRef = useRef<ExitSummaryData | undefined>(undefined)

  const exitFn = useCallback(
    async (reason?: unknown) => {
      if (exitingRef.current) return
      exitingRef.current = true

      // Hard exit safety net — if Ink's unmount/cleanup hangs (pending renders,
      // async effects, stdin listener teardown), guarantee termination after 2s.
      const hardExit = setTimeout(() => process.exit(0), 2000)
      hardExit.unref()

      // Reset window title before exiting
      if (process.platform === "win32") {
        process.title = ""
      }

      // Unmount Ink app
      inkExit()

      win32FlushInputBuffer()

      if (reason) {
        const formatted = FormatError(reason) ?? FormatUnknownError(reason)
        if (formatted) {
          process.stderr.write(`${formatted}\n`)
        }
      }

      const text = messageRef.current
      if (text) {
        process.stdout.write(`${text}\n`)
      }

      // Write exit summary AFTER inkExit() — summary must land on main buffer
      // (alternate screen has already been exited by inkExit). This follows
      // Claude Code's cleanupTerminalModes() → printResumeHint() ordering.
      const stats = statsRef.current
      if (stats) {
        const summary = formatExitSummary(stats)
        if (summary) {
          process.stdout.write(summary)
        }
      }

      await onExit?.()
    },
    [inkExit, onExit],
  )

  const store = useMemo(
    () => ({
      set: (value?: string) => {
        const prev = message
        setMessage(value)
        return () => {
          setMessage(prev)
        }
      },
      clear: () => {
        setMessage(undefined)
      },
      get: () => message,
    }),
    [message],
  )

  const statsStore = useMemo(
    () => ({
      set: (value: ExitSummaryData) => {
        statsRef.current = value
      },
    }),
    [],
  )

  const value = useMemo(() => Object.assign(exitFn, { message: store, stats: statsStore }), [exitFn, store, statsStore])

  return <ExitContext.Provider value={value}>{children}</ExitContext.Provider>
}
