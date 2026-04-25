/** @jsxImportSource react */
import { useMemo } from "react"
import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { DialogPrompt } from "../ui/dialog-prompt"

interface DialogSessionRenameProps {
  session: string
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const session = useMemo(() => sync.session.get(props.session), [sync.session, props.session])

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
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
