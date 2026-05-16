import { Box, Text } from "@liteai/ink"
import type React from "react"
import { useState } from "react"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"
import { DialogPane } from "../primitives/dialog-pane"
export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
}

export function DialogConfirm({ title, message, onConfirm, onCancel }: DialogConfirmProps): React.ReactNode {
  const [active, setActive] = useState<"confirm" | "cancel">("confirm")

  useRegisterKeybindingContext("Confirmation")

  useKeybindings(
    {
      "confirm:yes": () => (active === "confirm" ? onConfirm?.() : onCancel?.()),
      "confirm:no": () => onCancel?.(),
      "confirm:previous": () => setActive((a) => (a === "confirm" ? "cancel" : "confirm")),
      "confirm:next": () => setActive((a) => (a === "confirm" ? "cancel" : "confirm")),
    },
    { context: "Confirmation" },
  )

  return (
    <DialogPane title={title}>
      <Box paddingBottom={1}>
        <Text dim>{message}</Text>
      </Box>
      <Box flexDirection="row" justifyContent="flex-end" paddingBottom={1} gap={1}>
        <Box paddingX={1} borderStyle="round" borderColor={active === "cancel" ? "ansi:blue" : "ansi:black"}>
          <Text color={active === "cancel" ? "ansi:blue" : "ansi:blackBright"}>Cancel</Text>
        </Box>
        <Box paddingX={1} borderStyle="round" borderColor={active === "confirm" ? "ansi:blue" : "ansi:black"}>
          <Text color={active === "confirm" ? "ansi:blue" : "ansi:blackBright"}>Confirm</Text>
        </Box>
      </Box>
    </DialogPane>
  )
}
