import { Box } from "@liteai/ink"
import type React from "react"
import { useState } from "react"
import { TextInput } from "../components/text-input"
import { DialogPane } from "../primitives/dialog-pane"
import { useDialogLifecycle } from "../primitives/use-dialog-lifecycle"
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

  useDialogLifecycle({
    contextName: "Select",
    onClose: () => onCancel?.(),
    isActive: !!onCancel,
  })

  return (
    <DialogPane title={title}>
      <Box flexDirection="column" gap={1} paddingBottom={1}>
        {description && <Box>{description}</Box>}
        <Box borderStyle="round" paddingX={1} borderColor="ansi:blue" width="100%">
          <TextInput
            value={input}
            onChange={setInput}
            placeholder={placeholder}
            onSubmit={(val: string) => onConfirm?.(val)}
            focus={true}
            disableEscapeDoublePress={true}
          />
        </Box>
      </Box>
    </DialogPane>
  )
}
