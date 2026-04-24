/** @jsxImportSource react */
import { useApp } from "@liteai/ink"
import { useCallback, useMemo, useState } from "react"
import { win32FlushInputBuffer } from "../../cli/cmd/tui/win32"
import { FormatError, FormatUnknownError } from "../../cli/error"
import { createSimpleContext } from "./helper"

export type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
}

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const { exit: inkExit } = useApp()
    const [message, setMessage] = useState<string | undefined>()
    const [isExiting, setIsExiting] = useState(false)

    const exitFn = useCallback(
      async (reason?: unknown) => {
        if (isExiting) return
        setIsExiting(true)

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

        if (message) {
          process.stdout.write(`${message}\n`)
        }

        await input.onExit?.()
      },
      [isExiting, inkExit, message, input.onExit],
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

    return useMemo(() => Object.assign(exitFn, { message: store }), [exitFn, store])
  },
})
