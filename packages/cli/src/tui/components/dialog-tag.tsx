import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { useMemo, useState } from "react"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { SelectPane } from "../ui/select-pane"

interface DialogTagProps {
  sessionID: string
  existingTags: string[]
  allTags: string[]
  onClose: () => void
}

export function DialogTag(props: DialogTagProps) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const [filter, setFilter] = useState("")

  const options = useMemo(() => {
    const matchedTags = props.allTags.filter((t) => !props.existingTags.includes(t))

    const items: Array<{ key: string; label: string; value: string; category: string; gutter?: React.ReactNode }> =
      matchedTags.map((t) => ({
        key: t,
        label: `#${t}`,
        value: t,
        category: "Existing Tags",
      }))

    if (filter && !props.allTags.includes(filter) && !props.existingTags.includes(filter)) {
      items.unshift({
        key: `__new__${filter}`,
        label: `Create tag "#${filter}"`,
        value: filter,
        category: "New Tag",
        gutter: <Text color={theme.success as Color}>+</Text>,
      })
    }

    return items
  }, [props.allTags, props.existingTags, filter, theme.success])

  return (
    <SelectPane
      title="Add Tag"
      placeholder="Type a new tag or select an existing one..."
      items={options}
      onFilter={setFilter}
      onSelect={(item) => {
        const newTags = [...props.existingTags, item.value]
        sdk.client.project.session.update({
          projectID: sdk.projectID,
          sessionID: props.sessionID,
          tags: newTags,
        })
        props.onClose()
      }}
      onClose={props.onClose}
      header={
        props.existingTags.length > 0 ? (
          <Box flexDirection="row" gap={1}>
            <Text color={theme.textMuted as Color}>Current tags:</Text>
            {props.existingTags.map((t) => (
              <Text key={t} color={theme.primary as Color}>
                #{t}
              </Text>
            ))}
          </Box>
        ) : undefined
      }
    />
  )
}
