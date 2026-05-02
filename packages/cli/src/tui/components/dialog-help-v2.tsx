import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type React from "react"
import { useDialog } from "../context/dialog"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useKeybindingContext, useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { getBindingDisplayText } from "../keybindings/resolver"
import { useKeybinding } from "../keybindings/use-keybinding"
import { Dialog } from "../ui/dialog"
import { Tab, Tabs } from "./design-system/Tabs"
import { TUI_COMMANDS } from "./prompt/prompt-input"

export function DialogHelpV2(): React.ReactNode {
  const dialog = useDialog()
  const sync = useSync()
  const { bindings } = useKeybindingContext()

  useRegisterKeybindingContext("Help")
  useKeybinding("help:dismiss", () => dialog.clear(), { context: "Help" })

  const { theme } = useTheme()

  // Group bindings by context
  const bindingsByContext = bindings.reduce(
    (acc: Record<string, typeof bindings>, binding: any) => {
      if (!acc[binding.context]) acc[binding.context] = []
      acc[binding.context]?.push(binding)
      return acc
    },
    {} as Record<string, typeof bindings>,
  )

  // Sort contexts alphabetically
  const sortedContexts = Object.keys(bindingsByContext).sort()

  // Merge and sort commands
  const allCommands = [...(sync.command ?? []), ...TUI_COMMANDS].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Dialog title="Help" hideInputGuide onCancel={() => dialog.clear()}>
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
                  {contextBindings.map((binding: any, idx: number) => {
                    const shortcut = getBindingDisplayText(binding.action, binding.context, bindings)
                    return (
                      <Box key={idx} flexDirection="row" justifyContent="space-between">
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
    </Dialog>
  )
}
