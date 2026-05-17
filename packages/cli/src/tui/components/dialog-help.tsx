import type { Color } from "@liteai/ink"
import { Box, Text, useInput } from "@liteai/ink"
import type React from "react"
import { useTheme } from "../context/theme"
import { useKeybindingContext, useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { getBindingDisplayText } from "../keybindings/resolver"
import { useKeybinding } from "../keybindings/use-keybinding"
import { useDelayedEscapeClose } from "../hooks/use-delayed-escape-close"
import { useAppState } from "../state"
import { Pane } from "./design-system/Pane"
import { Tab, Tabs } from "./design-system/Tabs"
import { TUI_COMMANDS } from "./prompt/prompt-input"

export function DialogHelp({ onClose }: { onClose: () => void }): React.ReactNode {
  const command = useAppState((s) => s.command)
  const { bindings } = useKeybindingContext()

  useRegisterKeybindingContext("Help")
  useKeybinding("help:dismiss", () => onClose(), { context: "Help" })

  useDelayedEscapeClose(onClose)

  const { theme } = useTheme()

  // Group bindings by context
  const bindingsByContext = bindings.reduce(
    (acc: Record<string, typeof bindings>, binding) => {
      if (!acc[binding.context]) acc[binding.context] = []
      acc[binding.context]?.push(binding)
      return acc
    },
    {} as Record<string, typeof bindings>,
  )

  // Sort contexts alphabetically
  const sortedContexts = Object.keys(bindingsByContext).sort()

  // Merge and sort commands
  const allCommands = [...(command ?? []), ...TUI_COMMANDS].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Pane color="info">
      <Tabs title="" color="info">
        <Tab title="General" id="General">
          <Box flexDirection="column" gap={1} marginTop={1} paddingX={1}>
            {sortedContexts.map((context) => {
              const contextBindings = bindingsByContext[context] ?? []
              return (
                <Box key={context} flexDirection="column" marginBottom={1}>
                  <Text bold color={theme.info as Color}>
                    {context}
                  </Text>
                  {contextBindings.map((binding) => {
                    const shortcut = getBindingDisplayText(binding.action ?? "", binding.context, bindings)
                    return (
                      <Box
                        key={`${binding.context}:${binding.action}`}
                        flexDirection="row"
                        justifyContent="space-between"
                      >
                        <Text>{binding.action}</Text>
                        <Text dim>{shortcut}</Text>
                      </Box>
                    )
                  })}
                </Box>
              )
            })}
          </Box>
        </Tab>
        <Tab title="Commands" id="Commands">
          <Box flexDirection="column" marginTop={1} paddingX={1}>
            {allCommands.map((cmd) => (
              <Box key={cmd.name} flexDirection="row" justifyContent="space-between">
                <Text bold>/{cmd.name}</Text>
                <Text dim>{cmd.description}</Text>
              </Box>
            ))}
          </Box>
        </Tab>
      </Tabs>
    </Pane>
  )
}
