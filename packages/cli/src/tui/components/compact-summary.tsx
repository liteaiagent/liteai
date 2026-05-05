import { Box, type Color, Text } from "@liteai/ink"
import { useTheme } from "../context/theme"
import { useSessionContext } from "../routes/session/ctx"

type Props = {
  auto: boolean
  overflow?: boolean
}

export function CompactSummary({ auto, overflow }: Props) {
  const { theme } = useTheme()
  let expanded = false
  try {
    const ctx = useSessionContext()
    expanded = ctx?.showPreCompaction ?? false
  } catch {
    // If not in a session context, default to false
  }

  let message = "📋 Conversation summarized (/compact)"
  if (overflow) {
    message = "📋 Context overflow — conversation summarized"
  } else if (auto) {
    message = "📋 Conversation automatically summarized"
  }

  return (
    <Box flexDirection="column" paddingY={1} alignItems="center" width="100%">
      <Text color={theme.border as Color}>
        {"─".repeat(15)} Summary {"─".repeat(15)}
      </Text>
      <Box paddingY={1} flexDirection="column" alignItems="center">
        <Text color={theme.info as Color}>{message}</Text>
        <Text color={theme.textMuted as Color} italic>
          (Press ctrl+e to {expanded ? "collapse" : "show full history"})
        </Text>
      </Box>
      <Text color={theme.border as Color}>{"─".repeat(39)}</Text>
    </Box>
  )
}
