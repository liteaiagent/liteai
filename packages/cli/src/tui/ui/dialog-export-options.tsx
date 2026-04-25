import { Box, Text, useInput } from "@liteai/ink"
import type React from "react"
import { useState } from "react"
import { Dialog } from "./dialog"

export type DialogExportOptionsProps = {
  defaultFilename: string
  defaultThinking: boolean
  defaultToolDetails: boolean
  defaultAssistantMetadata: boolean
  defaultOpenWithoutSaving: boolean
  onConfirm?: (options: {
    filename: string
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    openWithoutSaving: boolean
  }) => void
  onCancel?: () => void
}

export function DialogExportOptions({
  defaultFilename,
  defaultThinking,
  defaultToolDetails,
  defaultAssistantMetadata,
  defaultOpenWithoutSaving,
  onConfirm,
  onCancel,
}: DialogExportOptionsProps): React.ReactNode {
  const [filename, setFilename] = useState(defaultFilename)
  const [thinking, setThinking] = useState(defaultThinking)
  const [toolDetails, setToolDetails] = useState(defaultToolDetails)
  const [assistantMetadata, setAssistantMetadata] = useState(defaultAssistantMetadata)
  const [openWithoutSaving, setOpenWithoutSaving] = useState(defaultOpenWithoutSaving)

  type ActiveField = "filename" | "thinking" | "toolDetails" | "assistantMetadata" | "openWithoutSaving"
  const [active, setActive] = useState<ActiveField>("filename")

  useInput((char, _key, event) => {
    if (!event) return
    const keyName = event.keypress.name

    if (keyName === "return") {
      onConfirm?.({
        filename,
        thinking,
        toolDetails,
        assistantMetadata,
        openWithoutSaving,
      })
      return
    }

    if (keyName === "tab" || keyName === "down" || keyName === "up") {
      const order: ActiveField[] = ["filename", "thinking", "toolDetails", "assistantMetadata", "openWithoutSaving"]
      const currentIndex = order.indexOf(active)
      let nextIndex = currentIndex + (keyName === "up" ? -1 : 1)
      if (nextIndex < 0) nextIndex = order.length - 1
      if (nextIndex >= order.length) nextIndex = 0
      setActive(order[nextIndex] as ActiveField)
      return
    }

    if (keyName === "space" || char === " ") {
      if (active === "thinking") setThinking(!thinking)
      if (active === "toolDetails") setToolDetails(!toolDetails)
      if (active === "assistantMetadata") setAssistantMetadata(!assistantMetadata)
      if (active === "openWithoutSaving") setOpenWithoutSaving(!openWithoutSaving)
      return
    }

    if (active === "filename") {
      if (keyName === "backspace") {
        setFilename((prev) => prev.slice(0, -1))
      } else if (char) {
        setFilename((prev) => prev + char)
      }
    }
  })

  return (
    <Dialog title="Export Options" onCancel={() => onCancel?.()} isCancelActive>
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>Filename:</Text>
          <Box
            flexDirection="row"
            borderStyle="round"
            paddingX={1}
            borderColor={active === "filename" ? "ansi:blue" : "ansi:blackBright"}
          >
            <Text>{filename || <Text dim>Enter filename</Text>}</Text>
            {active === "filename" && <Text>█</Text>}
          </Box>
        </Box>

        <Box flexDirection="column">
          <Box flexDirection="row" gap={2} paddingLeft={1}>
            <Text color={active === "thinking" ? "ansi:blue" : "ansi:blackBright"}>{thinking ? "[x]" : "[ ]"}</Text>
            <Text color={active === "thinking" ? "ansi:blue" : undefined}>Include thinking</Text>
          </Box>
          <Box flexDirection="row" gap={2} paddingLeft={1}>
            <Text color={active === "toolDetails" ? "ansi:blue" : "ansi:blackBright"}>
              {toolDetails ? "[x]" : "[ ]"}
            </Text>
            <Text color={active === "toolDetails" ? "ansi:blue" : undefined}>Include tool details</Text>
          </Box>
          <Box flexDirection="row" gap={2} paddingLeft={1}>
            <Text color={active === "assistantMetadata" ? "ansi:blue" : "ansi:blackBright"}>
              {assistantMetadata ? "[x]" : "[ ]"}
            </Text>
            <Text color={active === "assistantMetadata" ? "ansi:blue" : undefined}>Include assistant metadata</Text>
          </Box>
          <Box flexDirection="row" gap={2} paddingLeft={1}>
            <Text color={active === "openWithoutSaving" ? "ansi:blue" : "ansi:blackBright"}>
              {openWithoutSaving ? "[x]" : "[ ]"}
            </Text>
            <Text color={active === "openWithoutSaving" ? "ansi:blue" : undefined}>Open without saving</Text>
          </Box>
        </Box>

        <Box paddingBottom={1} paddingTop={1}>
          <Text dim>
            {active === "filename"
              ? "Press Enter to confirm, Tab/Arrow for options"
              : "Press Space to toggle, Enter to confirm, Tab/Arrow to navigate"}
          </Text>
        </Box>
      </Box>
    </Dialog>
  )
}
