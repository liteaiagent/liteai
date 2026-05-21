import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { type ToastItem, type ToastVariant, useToast } from "../context/toast"

const VARIANT_ICONS: Record<ToastVariant, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✗",
}

const VARIANT_COLORS: Record<ToastVariant, Color> = {
  info: "ansi:blue",
  success: "ansi:green",
  warning: "ansi:yellow",
  error: "ansi:red",
}

/** Render a single toast notification with icon and themed styling — inline text, no borders. */
function ToastEntry({ toast }: { toast: ToastItem }): React.ReactNode {
  const color = VARIANT_COLORS[toast.variant]
  const icon = VARIANT_ICONS[toast.variant]

  return (
    <Box key={toast.id} paddingX={1}>
      <Text color={color}>
        {icon} {toast.title ? <Text bold>{toast.title}: </Text> : null}
        {toast.message}
      </Text>
    </Box>
  )
}

/**
 * Renders all active toasts as a vertical stack.
 * Designed to be placed in an absolute-positioned container at the bottom of the viewport.
 */
export function Toast(): React.ReactNode {
  const { toasts } = useToast()

  if (toasts.length === 0) {
    return null
  }

  return (
    <Box flexDirection="column" gap={0}>
      {toasts.map((toast) => (
        <ToastEntry key={toast.id} toast={toast} />
      ))}
    </Box>
  )
}
