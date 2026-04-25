/** @jsxImportSource react */
/**
 * Prompt input mode indicator component.
 * Adapted port from MVP `PromptInput/PromptInputModeIndicator.tsx`.
 *
 * Renders:
 * - `❯ ` for prompt mode (using figures.pointer)
 * - `! ` for bash mode
 *
 * Stripped:
 * - Agent swarm teammate colors (`isAgentSwarmsEnabled()`, `getTeammateColor()`)
 * - `viewingAgentName` / `viewingAgentColor` props (teammate panel navigation)
 * - React Compiler artifacts (_c(), $[n])
 */

import { Box, type Color, Text } from "@liteai/ink"
import figures from "figures"
import { useTheme } from "../../context/theme"
import type { PromptInputMode } from "../../types/text-input"

type PromptInputModeIndicatorProps = {
  readonly mode: PromptInputMode
  readonly isLoading: boolean
  /** Optional agent-specific color override (hex) */
  readonly agentColor?: Color
}

function PromptChar({ isLoading, color }: { isLoading: boolean; color?: Color }) {
  return (
    <Text color={color} dim={isLoading}>
      {figures.pointer}{" "}
    </Text>
  )
}

export function PromptInputModeIndicator({ mode, isLoading, agentColor }: PromptInputModeIndicatorProps) {
  const { theme } = useTheme()

  return (
    <Box alignItems="flex-start" alignSelf="flex-start" flexWrap="nowrap" justifyContent="flex-start">
      {mode === "bash" ? (
        <Text color={theme.warning as Color} dim={isLoading}>
          !{" "}
        </Text>
      ) : (
        <PromptChar isLoading={isLoading} color={agentColor} />
      )}
    </Box>
  )
}
