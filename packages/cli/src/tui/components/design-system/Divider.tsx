/** @jsxImportSource react */

import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"

// TODO: Replace with new useTerminalSize from ink/hooks
// import { useTerminalSize } from "../../hooks/useTerminalSize.js"
// import { stringWidth } from "../../ink/stringWidth.js"

type DividerProps = {
  width?: number
  color?: Color
  char?: string
  padding?: number
  title?: string
}

export function Divider({
  width = 80, // Fallback width for now
  color,
  char = "─",
  padding = 0,
  title,
}: DividerProps): React.ReactNode {
  // TODO: Use actual terminal width
  const terminalWidth = 80
  const effectiveWidth = Math.max(0, (width ?? terminalWidth) - padding)

  if (title) {
    const titleWidth = title.length + 2 // approx
    const sideWidth = Math.max(0, effectiveWidth - titleWidth)
    const leftWidth = Math.floor(sideWidth / 2)
    const rightWidth = sideWidth - leftWidth
    return (
      <Box flexDirection="row" alignItems="center">
        <Text color={color} dim={!color}>
          {char.repeat(leftWidth)}
        </Text>
        <Box flexGrow={0} flexShrink={0} paddingX={1}>
          <Text dim>{title}</Text>
        </Box>
        <Text color={color} dim={!color}>
          {char.repeat(rightWidth)}
        </Text>
      </Box>
    )
  }

  return (
    <Text color={color} dim={!color}>
      {char.repeat(effectiveWidth)}
    </Text>
  )
}
