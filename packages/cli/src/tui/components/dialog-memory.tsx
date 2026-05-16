import type React from "react"
import { useMemo } from "react"
import { useTheme } from "../context/theme"
import { useMemoryFiles } from "../hooks/use-memory-files"
import type { SelectItem } from "../primitives/types"
import { SelectPane } from "../ui/select-pane"
import { openFileInEditor } from "../util/editor"

type MemoryItem = { path: string; name: string }

type Props = {
  onClose: () => void
}

export function DialogMemory({ onClose }: Props): React.ReactNode {
  useTheme()
  const { files, loading } = useMemoryFiles()

  const items = useMemo<SelectItem<MemoryItem>[]>(
    () =>
      files.map((f) => ({
        key: f.path,
        value: { path: f.path, name: f.name },
        label: f.name,
        description: "Memory Document",
      })),
    [files],
  )

  return (
    <SelectPane
      title={`Memory Files${loading ? " (Loading…)" : ` (${items.length})`}`}
      placeholder="Search memory files…"
      items={items}
      onSelect={(item) => {
        void openFileInEditor(item.value.path)
        onClose()
      }}
      onClose={onClose}
    />
  )
}
