/**
 * ToolStatusIndicator — Renders the status icon for a tool call.
 *
 * Each ToolDisplayStatus maps to a distinct visual:
 * - Pending: ○ (muted)
 * - Executing: animated spinner
 * - Success: ✓ (success green)
 * - Confirming: ? (warning yellow)
 * - Cancelled: – (warning yellow)
 * - Error: ✗ (error red)
 *
 * Fixed-width (2ch) to maintain columnar alignment in DenseToolMessage.
 */

import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type React from "react"
import { STATUS_ICONS, ToolDisplayStatus } from "../constants/tool-status"
import { useTheme } from "../context/theme"
import { Spinner } from "../ui/spinner"

type Props = {
  status: ToolDisplayStatus
}

export function ToolStatusIndicator({ status }: Props): React.ReactNode {
  const { theme } = useTheme()

  if (status === ToolDisplayStatus.Executing) {
    return <Spinner />
  }

  const icon = STATUS_ICONS[status]
  const color = getStatusColor(status, theme)

  return (
    <Box width={2}>
      <Text color={color as Color}>{icon}</Text>
    </Box>
  )
}

function getStatusColor(status: ToolDisplayStatus, theme: ReturnType<typeof useTheme>["theme"]): string {
  switch (status) {
    case ToolDisplayStatus.Pending:
      return theme.textMuted as string
    case ToolDisplayStatus.Success:
      return theme.success as string
    case ToolDisplayStatus.Confirming:
      return theme.warning as string
    case ToolDisplayStatus.Cancelled:
      return theme.warning as string
    case ToolDisplayStatus.Error:
      return theme.error as string
    default:
      return theme.text as string
  }
}
