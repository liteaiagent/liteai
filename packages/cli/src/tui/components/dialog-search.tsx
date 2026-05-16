import { type Color, Text } from "@liteai/ink"
import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDebouncedValue } from "../hooks/use-debounced-value"
import type { SelectItem } from "../primitives/types"
import { SelectPane } from "../ui/select-pane"
import { openFileInEditor } from "../util/editor"

type SearchResult = {
  file: string
  line: number
  content: string
  matchStart: number
  matchEnd: number
}

function normalizePath(p: string) {
  const parts = p.split(/[/\\]/)
  if (parts.length > 3) {
    return `.../${parts.slice(-3).join("/")}`
  }
  return p
}

export function DialogSearch({ onClose }: { onClose: () => void }): React.ReactNode {
  const sdk = useSDK()
  const { theme } = useTheme()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const debounced = useDebouncedValue(query, 150)

  useEffect(() => {
    if (!debounced.trim()) {
      setResults([])
      return
    }
    const abort = new AbortController()
    sdk
      .fetch(`${sdk.url}/find?pattern=${encodeURIComponent(debounced)}&limit=50`, { signal: abort.signal })
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const parsedResults = data.map((d: Record<string, unknown>) => {
            const pathInfo = d.path as { text?: string } | undefined
            const linesInfo = d.lines as { text?: string } | undefined
            const submatches = d.submatches as Array<{ start?: number; end?: number }> | undefined
            return {
              file: pathInfo?.text || "Unknown",
              line: (d.line_number as number) || 0,
              content: linesInfo?.text || "",
              matchStart: submatches?.[0]?.start || 0,
              matchEnd: submatches?.[0]?.end || 0,
            }
          })
          setResults(parsedResults)
        }
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          // Search errors are non-critical — results simply don't update
        }
      })
    return () => abort.abort()
  }, [debounced, sdk])

  const items = useMemo<SelectItem<SearchResult>[]>(
    () =>
      results.map((r) => ({
        key: `${r.file}:${r.line}`,
        value: r,
        label: `${normalizePath(r.file)}:${r.line}`,
        description: r.content.trim(),
      })),
    [results],
  )

  const matchLabel =
    results.length > 0 ? (
      <Text color={theme.textMuted as Color}>{results.length} matches</Text>
    ) : query ? (
      <Text color={theme.textMuted as Color}>no matches</Text>
    ) : undefined

  return (
    <SelectPane
      title="Search Workspace"
      placeholder="Type to search…"
      items={items}
      skipFilter={true}
      onFilter={setQuery}
      onSelect={(item) => {
        openFileInEditor(item.value.file, item.value.line)
        onClose()
      }}
      onClose={onClose}
      headerEnd={matchLabel}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Enter open · Esc close</Text>}
    />
  )
}
