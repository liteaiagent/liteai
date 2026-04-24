/** @jsxImportSource react */

import { Box, Text, useInput } from "@liteai/ink"
import type React from "react"
import { useState } from "react"
import { Dialog } from "./dialog"

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
}

export function DialogConfirm({ title, message, onConfirm, onCancel }: DialogConfirmProps): React.ReactNode {
  const [active, setActive] = useState<"confirm" | "cancel">("confirm")

  useInput((_input, _key, event) => {
    if (!event) return
    const keyName = event.keypress.name

    if (keyName === "return") {
      if (active === "confirm") onConfirm?.()
      else onCancel?.()
      return
    }

    if (keyName === "left" || keyName === "right") {
      setActive((a) => (a === "confirm" ? "cancel" : "confirm"))
    }
  })

  return (
    <Dialog title={title} onCancel={() => onCancel?.()} isCancelActive>
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
    </Dialog>
  )
}
