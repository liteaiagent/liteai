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
      <Text color={theme.border as Color}>{"─".repeat(40)}</Text>
      <Box paddingY={1}>
        <Text color={theme.info as Color}>{message}</Text>
      </Box>
      <Text color={theme.border as Color}>{"─".repeat(40)}</Text>
    </Box>
  )
}
