import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { useEffect, useState } from "react"
import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useDebouncedValue } from "../hooks/use-debounced-value"
import { FuzzyPicker } from "../ui/fuzzy-picker"
import { openFileInEditor } from "../util/editor"

type SearchResult = {
  file: string
  line: number
  content: string
  matchStart: number
  matchEnd: number
}

function FilePreview({ path, line }: { path: string; line: number }) {
  const sdk = useSDK()
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    sdk
      .fetch(`${sdk.url}/file/content?path=${encodeURIComponent(path)}`, { signal: abort.signal })
      .then((r) => r.json())
      .then((res: Record<string, unknown>) => {
        if (typeof res.content === "string") setContent(res.content)
        else setError("File empty")
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError("Failed to load file")
      })
    return () => abort.abort()
  }, [sdk, path])

  if (error) {
    return (
      <Box padding={1} borderStyle="round" borderColor="ansi:red">
        <Text color="ansi:red">{error}</Text>
      </Box>
    )
  }

  if (!content) {
    return (
      <Box padding={1} borderStyle="round" borderColor="ansi:blackBright">
        <Text dim>Loading preview...</Text>
      </Box>
    )
  }

  const lines = content.split(/\r?\n/)
  const start = Math.max(0, line - 5)
  const end = Math.min(lines.length, line + 5)
  const previewLines = lines.slice(start, end)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="ansi:blackBright" paddingX={1} flexGrow={1}>
      {previewLines.map((l, i) => {
        const currentLine = start + i + 1
        const isMatch = currentLine === line
        return (
          <Box key={currentLine} flexDirection="row">
            <Box width={4} marginRight={1} alignItems="flex-end">
              <Text dim color={isMatch ? "ansi:yellow" : undefined}>
                {currentLine}
              </Text>
            </Box>
            <Text color={isMatch ? "ansi:yellow" : undefined}>{l}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

function normalizePath(p: string) {
  // Try to make path relative to workspace or just shorter
  const parts = p.split(/[\\/]/)
  if (parts.length > 3) {
    return `.../${parts.slice(-3).join("/")}`
  }
  return p
}

export function DialogSearch(): React.ReactNode {
  const sdk = useSDK()
  const dialog = useDialog()
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
          // console.error(err)
        }
      })
    return () => abort.abort()
  }, [debounced, sdk])

  return (
    <FuzzyPicker
      title="Search Workspace"
      items={results}
      getKey={(r) => `${r.file}:${r.line}`}
      renderItem={(r, focused) => (
        <Box>
          <Box width={30} marginRight={2} flexShrink={0}>
            <Text color={focused ? ("info" as Color) : undefined} wrap="truncate">
              {normalizePath(r.file)}:{r.line}
            </Text>
          </Box>
          <Text dim wrap="truncate">
            {r.content.trim()}
          </Text>
        </Box>
      )}
      renderPreview={(r) => <FilePreview path={r.file} line={r.line} />}
      previewPosition="right"
      onQueryChange={setQuery}
      onSelect={(r) => openFileInEditor(r.file, r.line)}
      onCancel={() => dialog.pop()}
      emptyMessage={(q) => (q ? "No matches found" : "Type to search…")}
      matchLabel={results.length > 0 ? `${results.length} matches` : undefined}
    />
  )
}
