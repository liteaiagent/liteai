import { Box, Text } from "@liteai/ink"
import type React from "react"
import { useEffect, useState } from "react"
import { useSDK } from "../context/sdk"
import { useToast } from "../context/toast"
import type { SelectItem } from "../primitives/types"
import { SelectPane } from "../ui/select-pane"

type StyleInfo = {
  name: string
  title: string
  description?: string
  content: string
}

type Props = {
  onClose: () => void
}

/**
 * Style picker dialog that fetches available styles from the core API
 * and allows the user to select one, updating the project config.
 */
export function DialogOutputStyle({ onClose }: Props): React.ReactNode {
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

  const items: SelectItem<string | null>[] = [
    {
      key: "__none__",
      label: "None (default)",
      value: null,
      description: "Use no custom output style",
    },
    ...styles.map((s) => ({
      key: s.name,
      label: s.title,
      value: s.name,
      description: s.description,
    })),
  ]

  return (
    <SelectPane
      title="Output Style"
      placeholder="Search styles..."
      items={items}
      current={activeStyle}
      onSelect={async (item) => {
        try {
          await sdk.fetch(`${sdk.url}/project/${sdk.projectID}/config`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ outputStyle: item.value }),
          })
          toast.show({
            variant: "success",
            message: item.value ? `Output style set to "${item.label}"` : "Output style cleared",
          })
        } catch (err) {
          toast.error(err)
        }
        onClose()
      }}
      onClose={onClose}
    />
  )
}
