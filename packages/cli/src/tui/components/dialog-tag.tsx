import { Box, type Color, Text } from "@liteai/ink"
import { useMemo, useState } from "react"
import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { DialogSelect } from "../ui/dialog-select"

interface DialogTagProps {
  sessionID: string
  existingTags: string[]
  allTags: string[]
}

export function DialogTag(props: DialogTagProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  const [filter, setFilter] = useState("")

  const options = useMemo(() => {
    const matchedTags = props.allTags.filter((t) => !props.existingTags.includes(t))

    const items: Array<{ title: string; value: string; category: string; bg?: string }> = matchedTags.map((t) => ({
      title: `#${t}`,
      value: t,
      category: "Existing Tags",
    }))

    if (filter && !props.allTags.includes(filter) && !props.existingTags.includes(filter)) {
      items.unshift({
        title: `Create tag "#${filter}"`,
        value: filter,
        category: "New Tag",
        bg: theme.success as string,
      })
    }

    return items
  }, [props.allTags, props.existingTags, filter, theme.success])

  return (
    <DialogSelect
      title="Add Tag"
      placeholder="Type a new tag or select an existing one..."
      options={options}
      onFilter={setFilter}
      onSelect={(opt) => {
        const newTags = [...props.existingTags, opt.value]
        sdk.client.project.session.update({
          projectID: sdk.projectID,
          sessionID: props.sessionID,
          tags: newTags,
        })
        dialog.clear()
      }}
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
