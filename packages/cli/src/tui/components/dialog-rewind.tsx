import type { Snapshot } from "@liteai/core/snapshot/index"
import type { Color } from "@liteai/ink"
import { Box, Text, useInput } from "@liteai/ink"
import type { Message, Session } from "@liteai/sdk"
import type React from "react"
import { useCallback, useEffect, useState } from "react"
import { useDialog } from "../context/dialog"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useSession } from "../context/session"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useTurnDiffs } from "../hooks/use-turn-diffs"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"
import { selectMessages, useAppActions, useAppState } from "../state"
import { Dialog } from "../ui/dialog"
import { DialogRewindActions } from "./dialog-rewind-actions"

export function DialogRewind(): React.ReactNode {
  const dialog = useDialog()
  const session = useSession()
  const sdk = useSDK()
  const route = useRoute()
  const toast = useToast()
  const { session: sessionActions } = useAppActions()
  const messages = useAppState(selectMessages(session.sessionID ?? ""))
  const partsMap = useAppState((s) => s.part)
  const { theme } = useTheme()

  const allMessages = messages
  const userMessages = allMessages.filter((m: Message) => m.role === "user")

  const [selectedIndex, setSelectedIndex] = useState(userMessages.length > 0 ? userMessages.length - 1 : 0)
  const [actionLoading, setActionLoading] = useState(false)

  // Query child sessions to show fork indicators (⑂) on turns that have forks
  const [childSessions, setChildSessions] = useState<Session[]>([])
  useEffect(() => {
    const sessionID = session.sessionID
    if (!sessionID) return
    sdk.client.project.session
      .children({ sessionID, projectID: sdk.projectID })
      .then((res) => {
        if (res.data) setChildSessions(res.data)
      })
      .catch(() => {
        // Children query is best-effort — failing silently is acceptable here
        // since the fork indicator is a non-critical UX enhancement
      })
  }, [session.sessionID, sdk])

  // Build a set of message IDs that have child forks for O(1) lookup
  const forkedMessageIds = new Set(childSessions.filter((c) => c.parentID).map((c) => c.parentID as string))

  const selectedMessage = userMessages[selectedIndex]
  const { diffs, loading } = useTurnDiffs(session.sessionID, selectedMessage?.id)

  const getTurnLabel = useCallback(
    (msg: Message) => {
      const parts = partsMap[msg.id] ?? []
      const textPart = parts.find((p) => p.type === "text" && "text" in p)
      const text = textPart && "text" in textPart ? textPart.text : "..."
      const truncated = text.replace(/\n/g, " ").slice(0, 40) + (text.length > 40 ? "..." : "")
      return `"${truncated}"`
    },
    [partsMap],
  )

  const handleShowActionMenu = () => {
    if (!selectedMessage) return
    dialog.push(() => (
      <DialogRewindActions
        sessionID={session.sessionID ?? ""}
        messageID={selectedMessage.id}
        turnLabel={getTurnLabel(selectedMessage)}
        onComplete={() => dialog.pop()}
      />
    ))
  }

  // Direct fork — bypasses action menu
  const handleDirectFork = useCallback(async () => {
    if (!selectedMessage || actionLoading) return
    const sessionID = session.sessionID
    if (!sessionID) return

    setActionLoading(true)
    try {
      const res = await sdk.client.project.session.fork({
        projectID: sdk.projectID,
        sessionID,
        messageID: selectedMessage.id,
      })
      toast.show({
        variant: "success",
        message: `Session forked from ${getTurnLabel(selectedMessage)}`,
      })
      dialog.clear()
      route.navigate({
        type: "session",
        sessionID: res.data?.id ?? "",
      })
    } catch (e: unknown) {
      const err = e as Error
      toast.show({
        variant: "error",
        message: err.message || "Fork failed",
      })
    } finally {
      setActionLoading(false)
    }
  }, [selectedMessage, actionLoading, session.sessionID, sdk, toast, dialog, route, getTurnLabel])

  // Direct revert — bypasses action menu
  const handleDirectRevert = useCallback(async () => {
    if (!selectedMessage || actionLoading) return
    const sessionID = session.sessionID
    if (!sessionID) return

    setActionLoading(true)
    try {
      await sdk.client.project.session.revert({
        projectID: sdk.projectID,
        sessionID,
        messageID: selectedMessage.id,
      })
      toast.show({
        variant: "success",
        message: `Reverted to ${getTurnLabel(selectedMessage)} (use /unrevert to undo)`,
      })
      sessionActions.sync(sessionID)
      dialog.clear()
    } catch (e: unknown) {
      const err = e as Error
      toast.show({
        variant: "error",
        message: err.message || "Revert failed",
      })
    } finally {
      setActionLoading(false)
    }
  }, [selectedMessage, actionLoading, session.sessionID, sdk, toast, dialog, sessionActions, getTurnLabel])

  useRegisterKeybindingContext("Select")
  useKeybindings(
    {
      "select:cancel": () => dialog.pop(),
      "select:previous": () => setSelectedIndex((i) => Math.max(0, i - 1)),
      "select:next": () => setSelectedIndex((i) => Math.min(userMessages.length - 1, i + 1)),
      "select:accept": handleShowActionMenu,
    },
    { context: "Select" },
  )

  // Direct-action shortcuts: f = fork, r = revert (skip menu)
  useInput((input, _key) => {
    if (actionLoading) return
    if (input === "f") {
      void handleDirectFork()
    }
    if (input === "r") {
      void handleDirectRevert()
    }
  })

  const additions = diffs.reduce((sum, d) => sum + d.additions, 0)
  const deletions = diffs.reduce((sum, d) => sum + d.deletions, 0)

  return (
    <Dialog title={actionLoading ? "Working..." : "Time Travel (Rewind)"} onCancel={() => dialog.pop()}>
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
                const hasFork = forkedMessageIds.has(msg.id)

                return (
                  <Box key={msg.id} flexDirection="row" gap={1}>
                    <Text color={isSelected ? (theme.primary as Color) : (theme.text as Color)}>
                      {isSelected ? ">" : " "}
                    </Text>
                    {hasFork && <Text color={theme.info as Color}>⑂</Text>}
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
                  {diffs.slice(0, 10).map((d: Snapshot.FileDiff, i: number) => (
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
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.textMuted as Color}>↑↓ navigate · Enter action menu · f fork · r revert · esc cancel</Text>
      </Box>
    </Dialog>
  )
}
