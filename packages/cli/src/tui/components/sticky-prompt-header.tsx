import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import figures from "figures"
import { useState } from "react"
import { useTheme } from "../context/theme"

type Props = {
  text: string
  onClick: () => void
}

/**
 * Context breadcrumb: when scrolled up into history, pin the current
 * conversation turn's prompt above the viewport so you know what Claude was
 * responding to.
 *
 * Height is FIXED at 1 row (truncate-end for long prompts).
 */
export function StickyPromptHeader({ text, onClick }: Props) {
  const [hover, setHover] = useState(false)
  const { theme } = useTheme()

  const bgColor = (hover ? theme.backgroundPanel : theme.backgroundElement) as Color

  return (
    <Box
      flexShrink={0}
      width="100%"
      height={1}
      paddingRight={1}
      backgroundColor={bgColor}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Text color={theme.textMuted as Color} wrap="truncate-end">
        {figures.pointer} {text}
      </Text>
    </Box>
  )
}
