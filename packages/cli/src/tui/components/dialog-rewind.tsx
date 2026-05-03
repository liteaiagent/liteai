import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type { Message } from "@liteai/sdk"
import type React from "react"
import { useState } from "react"
import { useDialog } from "../context/dialog"
import { useSession } from "../context/session"
import { useTheme } from "../context/theme"
import { useTurnDiffs } from "../hooks/use-turn-diffs"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"
import { selectMessages, useAppState } from "../state"
import { Dialog } from "../ui/dialog"

export function DialogRewind(): React.ReactNode {
  const dialog = useDialog()
  const session = useSession()
  const messages = useAppState(selectMessages(session.sessionID ?? ""))
  const partsMap = useAppState((s) => s.part)
  const { theme } = useTheme()

  const allMessages = messages
  const userMessages = allMessages.filter((m: Message) => m.role === "user")

  const [selectedIndex, setSelectedIndex] = useState(userMessages.length > 0 ? userMessages.length - 1 : 0)

  const selectedMessage = userMessages[selectedIndex]
  const { diffs, loading } = useTurnDiffs(session.sessionID, selectedMessage?.id)

  useRegisterKeybindingContext("Select")
  useKeybindings(
    {
      "select:cancel": () => dialog.pop(),
      "select:previous": () => setSelectedIndex((i) => Math.max(0, i - 1)),
      "select:next": () => setSelectedIndex((i) => Math.min(userMessages.length - 1, i + 1)),
      "select:accept": () => {
        // Revert functionality (Phase 5 or basic revert here)
        dialog.pop()
      },
    },
    { context: "Select" },
  )

  const additions = diffs.reduce((sum, d) => sum + d.additions, 0)
  const deletions = diffs.reduce((sum, d) => sum + d.deletions, 0)

  return (
    <Dialog title="Time Travel (Rewind)" onCancel={() => dialog.pop()}>
      <Box flexDirection="row" width="100%" gap={2} marginTop={1}>
        <Box flexDirection="column" width="50%">
          <Text bold color={theme.info as Color}>
            History
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {userMessages.length === 0 ? (
              <Text dim>No history available</Text>
            ) : (
              userMessages.map((msg: Message, i: number) => {
                const isSelected = i === selectedIndex
                const parts = partsMap[msg.id] ?? []
                const textPart = parts.find((p) => p.type === "text" && "text" in p)
                const text = textPart && "text" in textPart ? textPart.text : "..."
                const truncated = text.replace(/\n/g, " ").slice(0, 40) + (text.length > 40 ? "..." : "")

                return (
                  <Box key={msg.id} flexDirection="row" gap={1}>
                    <Text color={isSelected ? (theme.primary as Color) : (theme.text as Color)}>
                      {isSelected ? ">" : " "}
                    </Text>
                    <Text color={isSelected ? (theme.primary as Color) : (theme.text as Color)} dim={!isSelected}>
                      {truncated}
                    </Text>
                  </Box>
                )
              })
            )}
          </Box>
        </Box>
        <Box flexDirection="column" width="50%">
          <Text bold color={theme.info as Color}>
            Turn Diffs
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {loading ? (
              <Text dim>Loading diffs...</Text>
            ) : (
              <Box flexDirection="column">
                <Box flexDirection="row" gap={1} marginBottom={1}>
                  <Text dim>[</Text>
                  <Text>{diffs.length} files changed,</Text>
                  <Text color={theme.success as Color}>+{additions}</Text>
                  <Text color={theme.error as Color}>-{deletions}</Text>
                  <Text dim>]</Text>
                </Box>
                <Box flexDirection="column">
                  {/* biome-ignore lint/suspicious/noExplicitAny: d type is untyped */}
                  {diffs.slice(0, 10).map((d: any, i: number) => (
                    <Box key={i} flexDirection="row" gap={1}>
                      <Text color={theme.textMuted as Color}>•</Text>
                      <Text>{d.file}</Text>
                    </Box>
                  ))}
                  {diffs.length > 10 && <Text dim>...and {diffs.length - 10} more</Text>}
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Dialog>
  )
}
