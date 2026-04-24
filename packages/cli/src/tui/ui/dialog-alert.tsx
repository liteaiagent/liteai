/** @jsxImportSource react */

import { Box, Text, useInput } from "@liteai/ink"
import type React from "react"
import { Dialog } from "./dialog"

export type DialogAlertProps = {
  title: string
  message: string
  onConfirm?: () => void
}

export function DialogAlert({ title, message, onConfirm }: DialogAlertProps): React.ReactNode {
  useInput((_input, _key, event) => {
    if (!event) return
    if (event.keypress.name === "return") {
      onConfirm?.()
    }
  })

  return (
    <Dialog title={title} onCancel={() => onConfirm?.()} isCancelActive>
      <Box paddingBottom={1}>
        <Text dim>{message}</Text>
      </Box>
    </Dialog>
  )
}
