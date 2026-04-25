import { Box, Text } from "@liteai/ink"
import type React from "react"
import { useDialog } from "../context/dialog"
import { useKeybind } from "../context/keybind"
import { Dialog } from "./dialog"

export function DialogHelp(): React.ReactNode {
  const dialog = useDialog()
  const keybind = useKeybind()

  const entries = Object.keys(keybind.all)
    .filter((action) => keybind.all[action]?.length)
    .map((action) => ({
      action,
      shortcut: keybind.print(action),
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
