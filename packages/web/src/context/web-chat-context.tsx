import { ChatContextProvider, type PermissionController } from "@liteai/ui/panes"
import type { ParentProps } from "solid-js"
import { usePermission } from "./permission"
import { useSDK } from "./sdk"
import { createWebChatController, createWebSessionController } from "./web-chat-controller"
import { createWebSelectionController } from "./web-selection-controller"

/**
 * WebChatContextProvider — wires the abstract ChatController/SessionController/
 * SelectionController/PermissionController interfaces to the web app's
 * useSync/useSDK/useLocal/usePermission implementations.
 *
 * Must be nested inside SDKProvider + SyncProvider + LocalProvider + PermissionProvider
 * (which provide the underlying contexts this adapter reads from).
 */
export function WebChatContextProvider(props: ParentProps) {
  const chat = createWebChatController()
  const session = createWebSessionController()
  const selection = createWebSelectionController()

  const webPermission = usePermission()
  const sdk = useSDK()

  const permission: PermissionController = {
    isAutoAccepting(sessionID: string | undefined) {
      if (!sessionID) return webPermission.isAutoAcceptingDirectory(sdk.directory)
      return webPermission.isAutoAccepting(sessionID, sdk.directory)
    },
    toggle(sessionID: string | undefined) {
      if (!sessionID) {
        webPermission.toggleAutoAcceptDirectory(sdk.directory)
        return
      }
      webPermission.toggleAutoAccept(sessionID, sdk.directory)
    },
  }

  return (
    <ChatContextProvider chat={chat} session={session} selection={selection} permission={permission}>
      {props.children}
    </ChatContextProvider>
  )
}
