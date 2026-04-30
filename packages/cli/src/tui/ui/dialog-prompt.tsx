import { Box, Text, useInput } from "@liteai/ink"
import type React from "react"
import { useState } from "react"
import { Dialog } from "./dialog"

export type DialogPromptProps = {
  title: string
  description?: React.ReactNode
  placeholder?: string
  value?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}

export function DialogPrompt({
  title,
  description,
  placeholder = "Enter text...",
  value = "",
  onConfirm,
  onCancel,
}: DialogPromptProps): React.ReactNode {
  const [input, setInput] = useState(value)

  useInput((char, _key) => {
    if (_key.return) {
      onConfirm?.(input)
      return
    }
    if (_key.backspace || _key.delete) {
      setInput((prev) => prev.slice(0, -1))
      return
    }
    if (char) {
      setInput((prev) => prev + char)
    }
  })

  return (
    <Dialog title={title} onCancel={() => onCancel?.()} isCancelActive>
      <Box flexDirection="column" gap={1} paddingBottom={1}>
        {description && <Box>{description}</Box>}
        <Box flexDirection="row" borderStyle="round" paddingX={1} borderColor="ansi:blue">
          <Text>{input || <Text dim>{placeholder}</Text>}</Text>
          <Text>█</Text>
        </Box>
      </Box>
    </Dialog>
  )
}
