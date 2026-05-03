import { useApp } from "@liteai/ink"
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import { win32FlushInputBuffer } from "../../cli/cmd/tui/win32"
import { FormatError, FormatUnknownError } from "../../cli/error"
export type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
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

  const exitFn = useCallback(
    async (reason?: unknown) => {
      if (exitingRef.current) return
      exitingRef.current = true

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

  const value = useMemo(() => Object.assign(exitFn, { message: store }), [exitFn, store])

  return <ExitContext.Provider value={value}>{children}</ExitContext.Provider>
}
