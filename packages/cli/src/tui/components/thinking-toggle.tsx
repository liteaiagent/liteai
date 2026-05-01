import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useState } from "react"
import { useTheme } from "../context/theme"
import { useKeybinding } from "../keybindings/use-keybinding"
import { DialogSelect } from "../ui/dialog-select"

export type ThinkingToggleDialogProps = {
  currentValue: boolean
  onSelect: (enabled: boolean) => void
  onCancel: () => void
  isMidConversation: boolean
}

export function ThinkingToggleDialog({
  currentValue,
  onSelect,
  onCancel,
  isMidConversation,
}: ThinkingToggleDialogProps) {
  const { theme } = useTheme()
  const [showWarning, setShowWarning] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<boolean | null>(null)

  useKeybinding(
    "confirm:yes",
    () => {
      if (showWarning && pendingSelection !== null) {
        onSelect(pendingSelection)
      }
    },
    { context: "Confirmation", isActive: showWarning },
  )

  useKeybinding(
    "confirm:no",
    () => {
      if (showWarning) {
        onCancel()
      }
    },
    { context: "Confirmation", isActive: showWarning },
  )

  useKeybinding(
    "chat:cancel",
    () => {
      onCancel()
    },
    { context: "Chat", isActive: true },
  )

  if (showWarning && pendingSelection !== null) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.warning as Color}
        paddingX={2}
        paddingY={1}
        width={60}
      >
        <Text color={theme.warning as Color} bold>
          Warning
        </Text>
        <Box marginTop={1}>
          <Text>Changing thinking mode mid-conversation will increase latency and may reduce quality.</Text>
        </Box>
        <Box marginTop={1} gap={1}>
          <Text>Are you sure? (</Text>
          <Text color={theme.accent as Color} bold>
            y
          </Text>
          <Text>/</Text>
          <Text color={theme.accent as Color} bold>
            n
          </Text>
          <Text>)</Text>
        </Box>
      </Box>
    )
  }

  return (
    <DialogSelect
      title="Thinking Mode"
      options={[
        { title: "Enabled", value: true },
        { title: "Disabled", value: false },
      ]}
      current={currentValue}
      onSelect={(opt) => {
        if (isMidConversation && opt.value !== currentValue) {
          setPendingSelection(opt.value)
          setShowWarning(true)
        } else {
          onSelect(opt.value)
        }
      }}
      onEscape={onCancel}
    />
  )
}
