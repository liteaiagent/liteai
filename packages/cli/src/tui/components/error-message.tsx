/**
 * ErrorMessage — Persistent error display in conversation history.
 *
 * Renders session-level errors with a ✗ prefix in the error theme color.
 * These are distinct from ephemeral toast notifications — ErrorMessages
 * persist in the conversation scrollback so users can review past errors.
 *
 * @see FR-013 in spec.md
 */

import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type React from "react"
import { ERROR_ICON } from "../constants/tool-status"
import { useTheme } from "../context/theme"

type Props = {
  message: string
}

export function ErrorMessage({ message }: Props): React.ReactNode {
  const { theme } = useTheme()

  return (
    <Box paddingLeft={3} marginTop={1}>
      <Text color={theme.error as Color}>
        {ERROR_ICON} {message}
      </Text>
    </Box>
  )
}
