/**
 * Prompt input mode indicator component.
 * Adapted port from MVP `PromptInput/PromptInputModeIndicator.tsx`.
 *
 * Renders:
 * - Animated spinner (⠋⠙⠹…) while the agent is loading
 * - `❯ ` for prompt mode (using figures.pointer)
 * - `! ` for bash mode
 *
 * Stripped:
 * - Agent swarm teammate colors (`isAgentSwarmsEnabled()`, `getTeammateColor()`)
 * - `viewingAgentName` / `viewingAgentColor` props (teammate panel navigation)
 * - React Compiler artifacts (_c(), $[n])
 */

import { Box, type Color, Text, useAnimationFrame } from "@liteai/ink"
import figures from "figures"
import { useTheme } from "../../context/theme"
import type { PromptInputMode } from "../../types/text-input"

// ─── Spinner ──────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const
const SPINNER_INTERVAL_MS = 80

function LoadingSpinner({ color }: { color?: Color }) {
  const [, time] = useAnimationFrame(SPINNER_INTERVAL_MS)
  const frame = SPINNER_FRAMES[Math.floor(time / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length]
  return <Text color={color}>{frame} </Text>
}

// ─── Props ────────────────────────────────────────────────────────────────────

type PromptInputModeIndicatorProps = {
  readonly mode: PromptInputMode
  readonly isLoading: boolean
  /** Optional agent-specific color override (hex) */
  readonly agentColor?: Color
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PromptInputModeIndicator({ mode, isLoading, agentColor }: PromptInputModeIndicatorProps) {
  const { theme } = useTheme()

  return (
    <Box alignItems="flex-start" alignSelf="flex-start" flexWrap="nowrap" justifyContent="flex-start">
      {isLoading ? (
        <LoadingSpinner color={theme.primary as Color} />
      ) : mode === "bash" ? (
        <Text color={theme.warning as Color}>{"! "}</Text>
      ) : (
        <Text color={agentColor}>{figures.pointer} </Text>
      )}
    </Box>
  )
}
