import { type Color, Text } from "@liteai/ink"
import React from "react"
import { useTheme } from "../context/theme"
import { DialogSelect } from "../ui/dialog-select"

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
    { value: "save", title: "Save to File", description: `Exports to ${options.filename}` },
    { value: "open", title: "Open in Editor", description: "Opens markdown in your $EDITOR" },
    {
      value: "thinking",
      title: `Include Thinking: ${options.thinking ? "Yes" : "No"}`,
      description: "Include model thinking blocks",
    },
    {
      value: "tools",
      title: `Include Tools: ${options.toolDetails ? "Yes" : "No"}`,
      description: "Include tool call details",
    },
    {
      value: "metadata",
      title: `Include Metadata: ${options.assistantMetadata ? "Yes" : "No"}`,
      description: "Include token and model info",
    },
  ]

  return (
    <DialogSelect
      title="Export Options"
      options={items}
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
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Enter to toggle/export · Esc cancel</Text>}
    />
  )
}
