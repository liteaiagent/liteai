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

export type ToastItem = ToastOptions & { id: string }

export type ToastContextValue = {
  show: (options: ToastOptions) => void
  error: (err: unknown) => void
  toasts: ToastItem[]
}

export const { use: useToast, provider: ToastProvider } = createSimpleContext({
  name: "Toast",
  init: () => {
    const [toasts, setToasts] = useState<ToastItem[]>([])

    const show = useCallback((options: ToastOptions) => {
      const duration = options.duration ?? 3000
      const id = Math.random().toString(36).substring(2, 9)

      setToasts((prev) => [...prev, { ...options, id }])

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    }, [])

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
        toasts,
      }),
      [show, error, toasts],
    )
  },
})
