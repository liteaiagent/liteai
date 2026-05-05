import { type Color, Text } from "@liteai/ink"
import { useCallback, useState } from "react"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useAppActions } from "../state"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"

type Props = {
  sessionID: string
  messageID: string
  turnLabel: string
  onComplete: () => void
}

type ActionValue = "revert" | "fork" | "cancel"

export function DialogRewindActions({ sessionID, messageID, turnLabel, onComplete }: Props) {
  const sdk = useSDK()
  const route = useRoute()
  const toast = useToast()
  const { session: sessionActions } = useAppActions()
  const { theme } = useTheme()
  const [loading, setLoading] = useState(false)

  const options: DialogSelectOption<ActionValue>[] = [
    {
      title: "Revert conversation",
      description: `Revert to ${turnLabel}. Future messages will be preserved in history.`,
      value: "revert",
    },
    {
      title: "Fork from here",
      description: `Create a new child session branching off from ${turnLabel}.`,
      value: "fork",
    },
    {
      title: "Cancel",
      value: "cancel",
      description: "Return to time travel.",
    },
  ]

  const handleSelect = useCallback(
    async (option: DialogSelectOption<ActionValue>) => {
      if (option.value === "cancel") {
        onComplete()
        return
      }

      setLoading(true)
      try {
        if (option.value === "revert") {
          await sdk.client.project.session.revert({
            projectID: sdk.projectID,
            sessionID,
            messageID,
          })
          toast.show({
            variant: "success",
            message: `Reverted to ${turnLabel} (use /unrevert to undo)`,
          })
          sessionActions.sync(sessionID)
          onComplete()
        } else if (option.value === "fork") {
          const res = await sdk.client.project.session.fork({
            projectID: sdk.projectID,
            sessionID,
            messageID,
          })
          toast.show({
            variant: "success",
            message: `Session forked from ${turnLabel}`,
          })
          onComplete()
          route.navigate({
            type: "session",
            sessionID: res.data?.id ?? "",
          })
        }
      } catch (e: unknown) {
        const err = e as Error
        toast.show({
          variant: "error",
          message: err.message || "Action failed",
        })
      } finally {
        setLoading(false)
      }
    },
    [sdk, sessionID, messageID, turnLabel, toast, route, onComplete, sessionActions],
  )

  return (
    <DialogSelect
      title={loading ? "Working..." : `Action for ${turnLabel}`}
      options={options}
      onSelect={handleSelect}
      onEscape={onComplete}
      skipFilter={true}
      headerEnd={loading ? <Text color={theme.info as Color}>Loading...</Text> : undefined}
    />
  )
}
