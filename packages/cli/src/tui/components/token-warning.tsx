import { Box, type Color, Text } from "@liteai/ink"
import { useEffect, useRef } from "react"
import { useTheme } from "../context/theme"

type Props = {
  utilization: number
  compressionThreshold?: number // default 0.65
  onAutoCompact?: () => void
}

export function TokenWarning({ utilization, compressionThreshold = 0.65, onAutoCompact }: Props) {
  const { theme } = useTheme()
  const autoCompactFiredRef = useRef(false)

  useEffect(() => {
    if (utilization >= 0.8) {
      if (!autoCompactFiredRef.current) {
        autoCompactFiredRef.current = true
        onAutoCompact?.()
      }
    } else {
      // Reset when utilization drops below 80% (e.g., after compaction)
      autoCompactFiredRef.current = false
    }
  }, [utilization, onAutoCompact])

  if (utilization < compressionThreshold) {
    return null
  }

  const percent = Math.round(utilization * 100)

  if (utilization >= 0.8) {
    return (
      <Box paddingX={1} backgroundColor={theme.error as Color} width="100%">
        <Text color={theme.backgroundPanel as Color} bold>
          ⚠ Context nearly full ({percent}%). Auto-compacting…
        </Text>
      </Box>
    )
  }

  return (
    <Box paddingX={1} backgroundColor={theme.warning as Color} width="100%">
      <Text color={theme.backgroundPanel as Color} bold>
        ⚠ Context at {percent}%. Consider /compact.
      </Text>
    </Box>
  )
}
