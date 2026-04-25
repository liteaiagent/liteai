import type { Color } from "@liteai/ink"
import { Box, TerminalSizeContext, useInput } from "@liteai/ink"
import type React from "react"
import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { useTheme } from "./theme"

type DialogItem = {
  element: () => React.ReactNode
  onClose?: () => void
}

export type DialogSize = "medium" | "large"

export type DialogContextType = {
  push: (element: () => React.ReactNode, onClose?: () => void) => void
  pop: () => void
  replace: (element: () => React.ReactNode, onClose?: () => void) => void
  clear: () => void
  stack: DialogItem[]
  size: DialogSize
  setSize: (size: DialogSize) => void
}

const DialogContext = createContext<DialogContextType | null>(null)

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<DialogItem[]>([])
  const [size, setSize] = useState<DialogSize>("medium")
  const terminalSize = useContext(TerminalSizeContext)
  const { theme } = useTheme()

  const push = useCallback((element: () => React.ReactNode, onClose?: () => void) => {
    setStack((prev) => [...prev, { element, onClose }])
  }, [])

  const pop = useCallback(() => {
    setStack((prev) => {
      if (prev.length === 0) return prev
      const current = prev[prev.length - 1]
      current.onClose?.()
      return prev.slice(0, -1)
    })
  }, [])

  const replace = useCallback((element: () => React.ReactNode, onClose?: () => void) => {
    setStack((prev) => {
      for (const item of prev) {
        item.onClose?.()
      }
      return [{ element, onClose }]
    })
    setSize("medium")
  }, [])

  const clear = useCallback(() => {
    setStack((prev) => {
      for (const item of prev) {
        item.onClose?.()
      }
      return []
    })
    setSize("medium")
  }, [])

  useInput(
    (_input, _key) => {
      if (stack.length === 0) return
      // We do not intercept ctrl+c, Ink handles it natively. We handle escape to pop the dialog.
      // But wait, the individual dialog also handles escape. In SolidJS, the provider handled escape globally.
      // We will let the individual dialogs handle their own escape using `useInput`,
      // because React/Ink bubbles events down to focused inputs. If we catch it here globally, we might
      // prevent the focused input from catching it, or vice versa.
      // Actually, Ink's `useInput` fires everywhere.
      // We can just rely on the active dialog calling `pop()` or `clear()` via its `onCancel` prop.
    },
    { isActive: false },
  )

  const value = useMemo(
    () => ({
      push,
      pop,
      replace,
      clear,
      stack,
      size,
      setSize,
    }),
    [push, pop, replace, clear, stack, size],
  )

  const currentColumns = terminalSize?.columns || 80
  const currentRows = terminalSize?.rows || 24

  return (
    <DialogContext.Provider value={value}>
      <Box flexDirection="column" flexGrow={1} height="100%">
        {children}
        {stack.length > 0 && (
          <Box
            position="absolute"
            top={0}
            left={0}
            right={0}
            bottom={0}
            justifyContent="center"
            alignItems="center"
            paddingTop={Math.floor(currentRows / 4)}
            // Ink does not support RGBA backgrounds with opacity, so we just position the dialog.
          >
            <Box
              width={size === "large" ? 80 : 60}
              maxWidth={currentColumns - 2}
              flexDirection="column"
              backgroundColor={theme.backgroundPanel as Color}
              paddingTop={1}
            >
              {stack[stack.length - 1].element()}
            </Box>
          </Box>
        )}
      </Box>
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogContextType {
  const context = useContext(DialogContext)
  if (!context) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return context
}
