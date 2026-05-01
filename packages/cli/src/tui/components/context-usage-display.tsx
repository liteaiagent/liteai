import { Box, type Color, Text } from "@liteai/ink"
import { useMemo } from "react"
import { useTheme } from "../context/theme"

type Props = {
  utilization: number // 0.0–1.0
  contextLimit: number
}

const BAR_WIDTH = 20

export function ContextUsageDisplay({ utilization, contextLimit }: Props) {
  const { theme } = useTheme()

  const clamped = Math.min(1, Math.max(0, utilization))
  const filledCount = Math.round(clamped * BAR_WIDTH)
  const emptyCount = BAR_WIDTH - filledCount

  const color = useMemo(() => {
    if (clamped >= 0.85) return theme.error
    if (clamped >= 0.6) return theme.warning
    return theme.success
  }, [clamped, theme])

  const filledStr = "█".repeat(filledCount)
  const emptyStr = "░".repeat(emptyCount)
  const percent = Math.round(clamped * 100)

  const usedTokens = Math.round(clamped * contextLimit)
  const formatTokens = (t: number) => {
    if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`
    if (t >= 1_000) return `${(t / 1_000).toFixed(1)}k`
    return `${t}`
  }

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={color as Color}>{filledStr}</Text>
      <Text color={theme.textMuted as Color}>{emptyStr}</Text>
      <Text color={theme.text as Color}>
        {percent}%{" "}
        <Text color={theme.textMuted as Color}>
          ({formatTokens(usedTokens)} / {formatTokens(contextLimit)})
        </Text>
      </Text>
    </Box>
  )
}
