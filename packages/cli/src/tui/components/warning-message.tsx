/**
 * WarningMessage — Persistent warning display in conversation history.
 *
 * Renders session-level warnings with a ⚠ prefix in the warning theme color.
 * These persist in the conversation scrollback for review.
 *
 * @see FR-013 in spec.md
 */

import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type React from "react"
import { WARNING_ICON } from "../constants/tool-status"
import { useTheme } from "../context/theme"

type Props = {
  message: string
}

export function WarningMessage({ message }: Props): React.ReactNode {
  const { theme } = useTheme()

  return (
    <Box paddingLeft={3} marginTop={1}>
      <Text color={theme.warning as Color}>
        {WARNING_ICON} {message}
      </Text>
    </Box>
  )
}
