import { useMemo } from "react"
import { useSDK } from "../context/sdk"
import { selectSessions, useAppState } from "../state"
import { DialogPrompt } from "../ui/dialog-prompt"

interface DialogSessionRenameProps {
  session: string
  onClose: () => void
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const sessionsList = useAppState(selectSessions())
  const sdk = useSDK()
  const session = useMemo(() => sessionsList.find((s) => s.id === props.session), [sessionsList, props.session])

  return (
    <DialogPrompt
      title="Rename Session"
      value={session?.title}
      onConfirm={(value) => {
        sdk.client.project.session.update({
          projectID: sdk.projectID,
          sessionID: props.session,
          title: value,
        })
        props.onClose()
      }}
      onCancel={props.onClose}
    />
  )
}
