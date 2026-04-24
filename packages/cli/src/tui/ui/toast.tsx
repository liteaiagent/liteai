/** @jsxImportSource react */

import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { type ToastVariant, useToast } from "../context/toast"

export function Toast(): React.ReactNode {
  const { currentToast } = useToast()

  if (!currentToast) {
    return null
  }

  const colors: Record<ToastVariant, Color> = {
    info: "ansi:blue",
    success: "ansi:green",
    warning: "ansi:yellow",
    error: "ansi:red",
  }

  const color = colors[currentToast.variant]

  return (
    <Box flexDirection="row" paddingX={1} paddingY={0} borderStyle="round" borderColor={color} marginTop={1}>
      <Text color={color}>
        {currentToast.title ? <Text bold>{currentToast.title}: </Text> : null}
        {currentToast.message}
      </Text>
    </Box>
  )
}
