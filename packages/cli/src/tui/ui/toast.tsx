/** @jsxImportSource react */

import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { useToast } from "../context/toast"

export function Toast(): React.ReactNode {
  const { currentToast } = useToast()

  if (!currentToast) {
    return null
  }

  const colors: Record<string, Color> = {
    info: "ansi:blue",
    success: "ansi:green",
    warning: "ansi:yellow",
    error: "ansi:red",
  }

  const color = colors[currentToast.variant] || "ansi:white"

  return (
    <Box flexDirection="row" paddingX={1} paddingY={0} borderStyle="round" borderColor={color} marginTop={1}>
      <Text color={color as Color}>
        {currentToast.title ? <Text bold>{currentToast.title}: </Text> : null}
        {currentToast.message}
      </Text>
    </Box>
  )
}
