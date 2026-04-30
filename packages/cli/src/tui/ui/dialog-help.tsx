import { Box, Text } from "@liteai/ink"
import type React from "react"
import { useDialog } from "../context/dialog"
import { useKeybindingContext } from "../keybindings/keybinding-context"
import { Dialog } from "./dialog"

export function DialogHelp(): React.ReactNode {
  const dialog = useDialog()
  const keybindingContext = useKeybindingContext()

  const entries = keybindingContext.bindings
    .filter((binding) => binding.action !== null)
    .map((binding) => ({
      action: binding.action as string,
      shortcut: keybindingContext.getDisplayText(binding.action as string, binding.context) ?? "",
    }))

  return (
    <Dialog title="Keyboard Shortcuts" onCancel={() => dialog.clear()} isCancelActive>
      <Box flexDirection="column" paddingBottom={1} minWidth={40}>
        {entries.map(({ action, shortcut }) => (
          <Box key={action} flexDirection="row" justifyContent="space-between" paddingRight={2}>
            <Text>{action}</Text>
            <Text dim>{shortcut}</Text>
          </Box>
        ))}
      </Box>
    </Dialog>
  )
}
