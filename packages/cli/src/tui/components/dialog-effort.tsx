import { type Color, Text } from "@liteai/ink"
import type React from "react"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { SelectPane } from "../ui/select-pane"

type Props = {
  onClose: () => void
}

export function DialogEffort({ onClose }: Props): React.ReactNode {
  const sdk = useSDK()
  const { theme } = useTheme()
  const toast = useToast()

  const options = [
    { key: "low", value: "low", label: "Low", description: "Fast, concise responses" },
    { key: "medium", value: "medium", label: "Medium", description: "Balanced quality and speed" },
    { key: "high", value: "high", label: "High", description: "Thorough, detailed responses" },
  ]

  return (
    <SelectPane
      title="Set Effort Level"
      items={options}
      onSelect={async (item) => {
        await sdk.client.project.config.update({
          projectID: sdk.projectID,
          // biome-ignore lint/suspicious/noExplicitAny: SDK method not typed yet
          config: { effort: item.value } as any,
        })
        toast.show({ variant: "success", message: `Effort set to ${item.value}` })
        onClose()
      }}
      onClose={onClose}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Enter select · Esc cancel</Text>}
    />
  )
}
