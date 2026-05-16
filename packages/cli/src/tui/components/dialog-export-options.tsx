import { type Color, Text } from "@liteai/ink"
import React from "react"
import { useTheme } from "../context/theme"
import { SelectPane } from "../ui/select-pane"

type ExportOptions = {
  filename: string
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
  openWithoutSaving: boolean
}

type Props = {
  defaultFilename: string
  defaultThinking: boolean
  defaultToolDetails: boolean
  defaultAssistantMetadata: boolean
  defaultOpenWithoutSaving: boolean
  onConfirm: (opts: ExportOptions) => void
  onCancel: () => void
}

export function DialogExportOptions(props: Props): React.ReactNode {
  const { theme } = useTheme()

  const [options, setOptions] = React.useState<ExportOptions>({
    filename: props.defaultFilename,
    thinking: props.defaultThinking,
    toolDetails: props.defaultToolDetails,
    assistantMetadata: props.defaultAssistantMetadata,
    openWithoutSaving: props.defaultOpenWithoutSaving,
  })

  const items = [
    { key: "save", value: "save", label: "Save to File", description: `Exports to ${options.filename}` },
    { key: "open", value: "open", label: "Open in Editor", description: "Opens markdown in your $EDITOR" },
    {
      key: "thinking",
      value: "thinking",
      label: `Include Thinking: ${options.thinking ? "Yes" : "No"}`,
      description: "Include model thinking blocks",
    },
    {
      key: "tools",
      value: "tools",
      label: `Include Tools: ${options.toolDetails ? "Yes" : "No"}`,
      description: "Include tool call details",
    },
    {
      key: "metadata",
      value: "metadata",
      label: `Include Metadata: ${options.assistantMetadata ? "Yes" : "No"}`,
      description: "Include token and model info",
    },
  ]

  return (
    <SelectPane
      title="Export Options"
      items={items}
      onSelect={(item: { value: string }) => {
        if (item.value === "save") {
          props.onConfirm({ ...options, openWithoutSaving: false })
        } else if (item.value === "open") {
          props.onConfirm({ ...options, openWithoutSaving: true })
        } else if (item.value === "thinking") {
          setOptions((o) => ({ ...o, thinking: !o.thinking }))
        } else if (item.value === "tools") {
          setOptions((o) => ({ ...o, toolDetails: !o.toolDetails }))
        } else if (item.value === "metadata") {
          setOptions((o) => ({ ...o, assistantMetadata: !o.assistantMetadata }))
        }
      }}
      onClose={props.onCancel}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Enter to toggle/export · Esc cancel</Text>}
    />
  )
}
