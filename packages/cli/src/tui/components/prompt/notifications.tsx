/**
 * Notifications component (right side of prompt footer).
 * Adapted port from MVP `PromptInput/Notifications.tsx`.
 *
 * Displays (right side of footer):
 * 1. Model name — from `useLocal().model.parsed()`
 * 2. Debug indicator — when verbose/debug mode is active
 * 3. Toast messages — from `useToast().toasts` with variant-based colors
 *
 * Stripped:
 * - All feature-flag gated code (VOICE_MODE, KAIROS, KAIROS_BRIEF)
 * - Auto-updater (`AutoUpdaterWrapper`)
 * - API key status display
 * - IDE selection indicator (`IdeStatusIndicator`)
 * - MCP server connection display
 * - Memory usage indicator
 * - Token warning / token count
 * - Sandbox footer hint
 * - SentryErrorBoundary
 * - Notifications queue system (env hooks, external editor hints)
 * - Overage mode indicator
 * - API key helper slow indicator
 * - React Compiler artifacts (_c(), $[n])
 */

import { Box, type Color, Text } from "@liteai/ink"
import { useLocal } from "../../context/local"
import { useTheme } from "../../context/theme"
import { useToast } from "../../context/toast"

type NotificationsProps = {
  readonly debug: boolean
  readonly verbose: boolean
  readonly isInputWrapped: boolean
  readonly isNarrow: boolean
}

/**
 * Map toast variant to a theme hex color.
 */
function variantColor(variant: string, theme: Record<string, unknown>): Color | undefined {
  switch (variant) {
    case "error":
      return theme.error as Color
    case "warning":
      return theme.warning as Color
    case "success":
      return theme.success as Color
    case "info":
      return theme.info as Color
    default:
      return undefined
  }
}

export function Notifications({ debug, verbose, isNarrow }: NotificationsProps) {
  const local = useLocal()
  const toast = useToast()
  const { theme } = useTheme()

  const parsed = local.model.parsed()
  const alignItems = isNarrow ? "flex-start" : "flex-end"

  return (
    <Box flexDirection="column" alignItems={alignItems} flexShrink={0} overflowX="hidden">
      {/* Toast messages */}
      {toast.toasts.map((t) => (
        <Text key={t.id} color={variantColor(t.variant, theme)} wrap="truncate">
          {t.message}
        </Text>
      ))}

      {/* Debug mode indicator */}
      {debug && (
        <Box>
          <Text color={theme.warning as Color} wrap="truncate">
            Debug mode
          </Text>
        </Box>
      )}

      {/* Verbose mode indicator */}
      {!debug && verbose && (
        <Box>
          <Text dim wrap="truncate">
            verbose
          </Text>
        </Box>
      )}

      {/* Model name display */}
      <Box>
        <Text dim wrap="truncate">
          {parsed.model}
        </Text>
      </Box>
    </Box>
  )
}
