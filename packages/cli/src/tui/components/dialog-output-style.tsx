import { Box, Text } from "@liteai/ink"
import type React from "react"
import { useEffect, useState } from "react"
import { useSDK } from "../context/sdk"
import { useToast } from "../context/toast"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"

type StyleInfo = {
  name: string
  title: string
  description?: string
  content: string
}

type Props = {
  onDone: () => void
}

/**
 * Style picker dialog that fetches available styles from the core API
 * and allows the user to select one, updating the project config.
 */
export function DialogOutputStyle({ onDone }: Props): React.ReactNode {
  const sdk = useSDK()
  const toast = useToast()
  const [styles, setStyles] = useState<StyleInfo[]>([])
  const [activeStyle, setActiveStyle] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const [stylesRes, activeRes] = await Promise.all([
          sdk.fetch(`${sdk.url}/project/${sdk.projectID}/style`).then((r) => r.json() as Promise<StyleInfo[]>),
          sdk
            .fetch(`${sdk.url}/project/${sdk.projectID}/style/active`)
            .then((r) => r.json() as Promise<StyleInfo | null>),
        ])
        setStyles(stylesRes)
        setActiveStyle(activeRes?.name ?? null)
      } catch (err) {
        toast.error(err)
      } finally {
        setLoading(false)
      }
    })()
  }, [sdk, toast])

  if (loading) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text dim>Loading styles…</Text>
      </Box>
    )
  }

  const options: DialogSelectOption<string | null>[] = [
    {
      title: "None (default)",
      value: null,
      description: "Use no custom output style",
    },
    ...styles.map((s) => ({
      title: s.title,
      value: s.name,
      description: s.description,
    })),
  ]

  return (
    <DialogSelect
      title="Output Style"
      placeholder="Search styles..."
      options={options}
      current={activeStyle}
      onSelect={async (option) => {
        try {
          // Update config via the config PATCH endpoint
          await sdk.fetch(`${sdk.url}/project/${sdk.projectID}/config`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ outputStyle: option.value }),
          })
          toast.show({
            variant: "success",
            message: option.value ? `Output style set to "${option.title}"` : "Output style cleared",
          })
        } catch (err) {
          toast.error(err)
        }
        onDone()
      }}
      onEscape={onDone}
    />
  )
}
