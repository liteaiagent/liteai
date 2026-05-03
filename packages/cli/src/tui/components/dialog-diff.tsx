import { Box, type Color, TerminalSizeContext, Text } from "@liteai/ink"
import type React from "react"
import { useContext, useState } from "react"
import { useDialog } from "../context/dialog"
import { useSession } from "../context/session"
import { useTheme } from "../context/theme"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"
import { useAppState } from "../state"
import { Dialog } from "../ui/dialog"
import { StructuredDiff } from "./structured-diff"

export function DialogDiff(): React.ReactNode {
  const dialog = useDialog()
  const session = useSession()
  const session_diff = useAppState((s) => s.session_diff)
  const { theme } = useTheme()
  const terminalSize = useContext(TerminalSizeContext)
  const columns = terminalSize?.columns ?? 80

  const diffs = (session.sessionID ? session_diff[session.sessionID] : []) ?? []

  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [viewMode, setViewMode] = useState<"list" | "detail">("list")

  useRegisterKeybindingContext("DiffDialog")
  useKeybindings(
    {
      "diff:dismiss": () => {
        if (viewMode === "detail") setViewMode("list")
        else dialog.pop()
      },
      "diff:previousFile": () => {
        if (viewMode === "list") {
          setSelectedFileIndex((prev) => Math.max(0, prev - 1))
        }
      },
      "diff:nextFile": () => {
        if (viewMode === "list") {
          setSelectedFileIndex((prev) => Math.min(diffs.length - 1, prev + 1))
        }
      },
      "diff:viewDetails": () => {
        if (viewMode === "list" && diffs.length > 0) {
          setViewMode("detail")
        }
      },
    },
    { context: "DiffDialog" },
  )

  const selectedDiff = diffs[selectedFileIndex]

  if (diffs.length === 0) {
    return (
      <Dialog title="Session Diff" onCancel={() => dialog.pop()} hideInputGuide>
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
        else dialog.pop()
      }}
      hideInputGuide
    >
      <Box flexDirection="column" marginTop={1}>
        {viewMode === "list" ? (
          <Box flexDirection="column">
            {diffs.map((diff, idx) => {
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
