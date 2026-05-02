import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { useDialog } from "../context/dialog"
import { useTheme } from "../context/theme"
import { useMemoryFiles } from "../hooks/use-memory-files"
import { FuzzyPicker } from "../ui/fuzzy-picker"
import { openFileInEditor } from "../util/editor"

export function DialogMemory(): React.ReactNode {
  const dialog = useDialog()
  const { theme } = useTheme()
  const { files, loading } = useMemoryFiles()
  const [_query, setQuery] = useState("")

  const options = useMemo(() => {
    return files.map((f) => ({
      value: f.path,
      label: f.name,
      description: "Memory Document",
    }))
  }, [files])

  useEffect(() => {
    dialog.setSize("medium")
  }, [dialog])

  return (
    <FuzzyPicker
      title={`Memory Files ${loading ? "(Loading...)" : `(${options.length})`}`}
      items={options}
      placeholder="Search memory files..."
      getKey={(item) => item.value}
      getSearchString={(item) => item.label}
      renderItem={(item, isFocused) => (
        <Box flexDirection="row">
          <Box width={30} marginRight={2}>
            <Text color={isFocused ? ("info" as Color) : undefined} wrap="truncate">
              {item.label}
            </Text>
          </Box>
          <Text dim>{item.description}</Text>
        </Box>
      )}
      onQueryChange={setQuery}
      onSelect={(item) => {
        if (!item) return
        void openFileInEditor(item.value)
        dialog.clear()
      }}
      onCancel={() => dialog.pop()}
      emptyMessage={loading ? "Loading memory files..." : "No memory files found."}
      extraHints={<Text color={theme.textMuted as Color}>↑/↓ Navigate · Enter Open in Editor · Esc Close</Text>}
    />
  )
}
