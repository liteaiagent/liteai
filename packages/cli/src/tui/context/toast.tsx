/** @jsxImportSource react */
import { useCallback, useMemo, useState } from "react"
import { createSimpleContext } from "./helper"

export type ToastVariant = "info" | "success" | "warning" | "error"

export type ToastOptions = {
  message: string
  title?: string
  variant: ToastVariant
  duration?: number
}

export type ToastContextValue = {
  show: (options: ToastOptions) => void
  error: (err: unknown) => void
  currentToast: ToastOptions | null
}

export const { use: useToast, provider: ToastProvider } = createSimpleContext({
  name: "Toast",
  init: () => {
    const [currentToast, setCurrentToast] = useState<ToastOptions | null>(null)
    const [timeoutHandle, setTimeoutHandle] = useState<NodeJS.Timeout | null>(null)

    const show = useCallback(
      (options: ToastOptions) => {
        const duration = options.duration ?? 3000
        setCurrentToast(options)

        if (timeoutHandle) clearTimeout(timeoutHandle)

        const handle = setTimeout(() => {
          setCurrentToast(null)
        }, duration)

        setTimeoutHandle(handle)
      },
      [timeoutHandle],
    )

    const error = useCallback(
      (err: unknown) => {
        if (err instanceof Error) {
          return show({
            variant: "error",
            message: err.message,
          })
        }
        show({
          variant: "error",
          message: "An unknown error has occurred",
        })
      },
      [show],
    )

    return useMemo(
      () => ({
        show,
        error,
        currentToast,
      }),
      [show, error, currentToast],
    )
  },
})
