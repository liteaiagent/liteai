import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { useMemo, useState } from "react"
import { useTheme } from "../context/theme"
import { useMemoryFiles } from "../hooks/use-memory-files"
import { FuzzyPicker } from "../ui/fuzzy-picker"
import { openFileInEditor } from "../util/editor"

type Props = {
  onClose: () => void
}

export function DialogMemory({ onClose }: Props): React.ReactNode {
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
        onClose()
      }}
      onCancel={onClose}
      emptyMessage={loading ? "Loading memory files..." : "No memory files found."}
      extraHints={<Text color={theme.textMuted as Color}>↑/↓ Navigate · Enter Open in Editor · Esc Close</Text>}
    />
  )
}
