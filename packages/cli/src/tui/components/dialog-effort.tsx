import { type Color, Text } from "@liteai/ink"
import type React from "react"
import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { DialogSelect } from "../ui/dialog-select"

export function DialogEffort(): React.ReactNode {
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()

  const options = [
    { value: "low", title: "Low", description: "Fast, concise responses" },
    { value: "medium", title: "Medium", description: "Balanced quality and speed" },
    { value: "high", title: "High", description: "Thorough, detailed responses" },
  ]

  return (
    <DialogSelect
      title="Set Effort Level"
      options={options}
      onSelect={async (option: { value: string }) => {
        await sdk.client.project.config.update({
          projectID: sdk.projectID,
          // biome-ignore lint/suspicious/noExplicitAny: SDK method not typed yet
          config: { effort: option.value } as any,
        })
        toast.show({ variant: "success", message: `Effort set to ${option.value}` })
        dialog.pop()
      }}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Enter select · Esc cancel</Text>}
    />
  )
}
