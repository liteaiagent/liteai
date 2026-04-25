import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { type ToastVariant, useToast } from "../context/toast"

export function Toast(): React.ReactNode {
  const { toasts } = useToast()

  if (toasts.length === 0) {
    return null
  }

  const colors: Record<ToastVariant, Color> = {
    info: "ansi:blue",
    success: "ansi:green",
    warning: "ansi:yellow",
    error: "ansi:red",
  }

  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      {toasts.map((toast) => {
        const color = colors[toast.variant]
        return (
          <Box key={toast.id} flexDirection="row" paddingX={1} paddingY={0} borderStyle="round" borderColor={color}>
            <Text color={color}>
              {toast.title ? <Text bold>{toast.title}: </Text> : null}
              {toast.message}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
