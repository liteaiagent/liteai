import { Box, Text } from "@liteai/ink"
import type React from "react"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"
import { DialogPane } from "../primitives/dialog-pane"
export type DialogAlertProps = {
  title: string
  message: string
  onConfirm?: () => void
}

export function DialogAlert({ title, message, onConfirm }: DialogAlertProps): React.ReactNode {
  useRegisterKeybindingContext("Confirmation")

  useKeybindings(
    {
      "confirm:yes": () => onConfirm?.(),
      "confirm:no": () => onConfirm?.(),
    },
    { context: "Confirmation" },
  )

  return (
    <DialogPane title={title}>
      <Box paddingBottom={1}>
        <Text dim>{message}</Text>
      </Box>
    </DialogPane>
  )
}
