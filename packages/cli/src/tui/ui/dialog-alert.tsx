import { Box, Text } from "@liteai/ink"
import type React from "react"
import { useKeybindings } from "../keybindings/use-keybinding"
import { Dialog } from "./dialog"

export type DialogAlertProps = {
  title: string
  message: string
  onConfirm?: () => void
}

export function DialogAlert({ title, message, onConfirm }: DialogAlertProps): React.ReactNode {
  useKeybindings(
    {
      "confirm:yes": () => onConfirm?.(),
    },
    { context: "Confirmation" },
  )

  return (
    <Dialog title={title} onCancel={() => onConfirm?.()} isCancelActive>
      <Box paddingBottom={1}>
        <Text dim>{message}</Text>
      </Box>
    </Dialog>
  )
}
