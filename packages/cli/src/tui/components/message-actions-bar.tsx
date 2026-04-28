/**
 * Message actions bar — contextual footer showing available keybinds
 * for message interaction.
 *
 * Renders a single-line bar of keybind hints, only showing actions
 * that are currently available in the session context.
 */

import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"

export type MessageAction = {
  /** Keybind name (from tui-schema) used to render the key hint */
  keybindName: string
  /** Human-readable label for the action */
  label: string
  /** Whether this action is currently available */
  available: boolean
}

type Props = {
  actions: MessageAction[]
}

export function MessageActionsBar({ actions }: Props) {
  const { theme } = useTheme()
  const keybind = useKeybind()

  const visibleActions = actions.filter((a) => a.available)
  if (visibleActions.length === 0) return null

  return (
    <Box paddingLeft={1} gap={1}>
      {visibleActions.map((action, i) => {
        const keyLabel = keybind.print(action.keybindName)
        return (
          <Box key={action.keybindName} gap={0}>
            {i > 0 && <Text color={theme.textMuted as Color}> · </Text>}
            <Text color={theme.accent as Color} bold>
              {keyLabel}
            </Text>
            <Text color={theme.textMuted as Color}> {action.label}</Text>
          </Box>
        )
      })}
    </Box>
  )
}
