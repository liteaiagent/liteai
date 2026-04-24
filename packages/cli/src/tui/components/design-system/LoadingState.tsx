import { Box, Text } from "@liteai/ink"
import type React from "react"
import { Spinner } from "../../ui/spinner.tsx"

type LoadingStateProps = {
  /**
   * The loading message to display next to the spinner.
   */
  message: string

  /**
   * Display the message in bold.
   * @default false
   */
  bold?: boolean

  /**
   * Display the message in dimmed color.
   * @default false
   */
  dimColor?: boolean

  /**
   * Optional subtitle displayed below the main message.
   */
  subtitle?: string
}

/**
 * A spinner with loading message for async operations.
 *
 * @example
 * // Basic loading
 * <LoadingState message="Loading..." />
 *
 * @example
 * // Bold loading message
 * <LoadingState message="Loading sessions" bold />
 *
 * @example
 * // With subtitle
 * <LoadingState
 *   message="Loading sessions"
 *   bold
 *   subtitle="Fetching your Claude Code sessions..."
 * />
 */
export function LoadingState({
  message,
  bold = false,
  dimColor = false,
  subtitle,
}: LoadingStateProps): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Spinner />
        <Text {...(bold ? { bold: true as const } : dimColor ? { dim: true as const } : {})}> {message}</Text>
      </Box>
      {subtitle && <Text dim>{subtitle}</Text>}
    </Box>
  )
}
