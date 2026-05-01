import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useTheme } from "../context/theme"
import { useKeybindingContext } from "../keybindings/keybinding-context"
import type { MessageActionContext } from "./message-action-registry"
import { getApplicableActions } from "./message-action-registry"

type Props = {
  ctx: MessageActionContext
}

export function MessageActionsBar({ ctx }: Props) {
  const { theme } = useTheme()
  const keybindContext = useKeybindingContext()

  const actions = getApplicableActions(ctx)

  return (
    <Box paddingLeft={1} gap={1} flexWrap="wrap">
      {actions.map((action, i) => {
        const bindName = `messageActions:${action.key}`
        const keyLabel = keybindContext.getDisplayText(bindName, "MessageActions") || action.key
        const labelText = typeof action.label === "function" ? action.label(ctx) : action.label
        return (
          <Box key={action.key} gap={0}>
            {i > 0 && <Text color={theme.textMuted as Color}> · </Text>}
            <Text color={theme.accent as Color} bold>
              {keyLabel}
            </Text>
            <Text color={theme.textMuted as Color}> {labelText}</Text>
          </Box>
        )
      })}

      <Box gap={0}>
        {actions.length > 0 && <Text color={theme.textMuted as Color}> · </Text>}
        <Text color={theme.textMuted as Color}>↑↓ navigate</Text>
      </Box>
      <Box gap={0}>
        <Text color={theme.textMuted as Color}> · esc back</Text>
      </Box>
    </Box>
  )
}
