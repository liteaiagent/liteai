import type React from "react"
import { createContext, useCallback, useContext, useMemo, useState } from "react"

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

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (context === undefined) {
    throw new Error("Toast context must be used within a context provider")
  }
  return context
}

export function ToastProvider({ children }: { children?: React.ReactNode }) {
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

  const value = useMemo(
    () => ({
      show,
      error,
      toasts,
    }),
    [show, error, toasts],
  )

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}
