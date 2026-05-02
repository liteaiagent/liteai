import { Box, type Color, Text } from "@liteai/ink"
import { useTheme } from "../context/theme"

type Props = {
  auto: boolean
  overflow?: boolean
}

export function CompactSummary({ auto, overflow }: Props) {
  const { theme } = useTheme()

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
          (Press ctrl+o to expand history)
        </Text>
      </Box>
      <Text color={theme.border as Color}>{"─".repeat(39)}</Text>
    </Box>
  )
}
