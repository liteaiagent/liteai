import { Box, type Color, TerminalSizeContext, Text } from "@liteai/ink"
import type React from "react"
import { useContext, useState } from "react"
import { useSession } from "../context/session"
import { useTheme } from "../context/theme"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"
import { useAppState } from "../state"
import { Dialog } from "../ui/dialog"
import { StructuredDiff } from "./structured-diff"

export function DialogDiff({ onClose }: { onClose: () => void }): React.ReactNode {
  const session = useSession()
  const session_diff = useAppState((s) => s.session_diff)
  const { theme } = useTheme()
  const terminalSize = useContext(TerminalSizeContext)
  const columns = terminalSize?.columns ?? 80

  const diffs = (session.sessionID ? session_diff[session.sessionID] : []) ?? []

  const totalAdditions = diffs.reduce((sum, d) => sum + d.additions, 0)
  const totalDeletions = diffs.reduce((sum, d) => sum + d.deletions, 0)

  const extCounts = new Map<string, number>()
  for (const d of diffs) {
    const ext = d.file.includes(".") ? `.${d.file.split(".").pop()}` : "other"
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)
  }
  const extSummary = [...extCounts.entries()].map(([ext, count]) => `${count} ${ext}`).join(" · ")

  const statusOrder: Record<string, number> = { added: 0, modified: 1, deleted: 2 }
  const sortedDiffs = [...diffs].sort((a, b) => (statusOrder[a.status ?? ""] ?? 1) - (statusOrder[b.status ?? ""] ?? 1))

  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [viewMode, setViewMode] = useState<"list" | "detail">("list")

  useRegisterKeybindingContext("DiffDialog")
  useKeybindings(
    {
      "diff:dismiss": () => {
        if (viewMode === "detail") setViewMode("list")
        else onClose()
      },
      "diff:previousFile": () => {
        if (viewMode === "list") {
          setSelectedFileIndex((prev) => Math.max(0, prev - 1))
        }
      },
      "diff:nextFile": () => {
        if (viewMode === "list") {
          setSelectedFileIndex((prev) => Math.min(sortedDiffs.length - 1, prev + 1))
        }
      },
      "diff:viewDetails": () => {
        if (viewMode === "list" && sortedDiffs.length > 0) {
          setViewMode("detail")
        }
      },
    },
    { context: "DiffDialog" },
  )

  const selectedDiff = sortedDiffs[selectedFileIndex]

  if (diffs.length === 0) {
    return (
      <Dialog title="Session Diff" onCancel={onClose} hideInputGuide>
        <Box padding={1}>
          <Text dim>No file changes in this session.</Text>
        </Box>
      </Dialog>
    )
  }

  return (
    <Dialog
      title={viewMode === "list" ? "Session Diff" : `Diff: ${selectedDiff?.file}`}
      onCancel={() => {
        if (viewMode === "detail") setViewMode("list")
        else onClose()
      }}
      hideInputGuide
    >
      <Box flexDirection="column" marginTop={1}>
        {viewMode === "list" ? (
          <Box flexDirection="column">
            <Box flexDirection="row" marginBottom={1} paddingX={2} gap={2}>
              <Text bold>{diffs.length} files changed</Text>
              <Text color={theme.success as Color}>+{totalAdditions}</Text>
              <Text color={theme.error as Color}>-{totalDeletions}</Text>
              <Box flexGrow={1} />
              <Text dim>{extSummary}</Text>
            </Box>
            {sortedDiffs.map((diff, idx) => {
              const isSelected = idx === selectedFileIndex
              let statusText = "M"
              let statusColor = theme.warning
              if (diff.status === "added") {
                statusText = "A"
                statusColor = theme.success
              } else if (diff.status === "deleted") {
                statusText = "D"
                statusColor = theme.error
              }

              return (
                <Box key={idx} flexDirection="row" gap={1}>
                  <Text color={isSelected ? (theme.primary as Color) : (theme.text as Color)}>
                    {isSelected ? ">" : " "}
                  </Text>
                  <Text color={statusColor as Color}>{statusText}</Text>
                  <Box flexGrow={1}>
                    <Text bold={isSelected}>{diff.file}</Text>
                  </Box>
                  <Text color={theme.success as Color}>+{diff.additions}</Text>
                  <Text color={theme.error as Color}>-{diff.deletions}</Text>
                </Box>
              )
            })}
          </Box>
        ) : (
          selectedDiff && (
            <Box flexDirection="column">
              <StructuredDiff
                originalContent={selectedDiff.before}
                modifiedContent={selectedDiff.after}
                width={columns - 6} // Account for dialog padding and borders
              />
            </Box>
          )
        )}
      </Box>
    </Dialog>
  )
}
