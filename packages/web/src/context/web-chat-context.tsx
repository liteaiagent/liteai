import { ChatContextProvider } from "@liteai/ui/panes"
import type { ParentProps } from "solid-js"
import { createWebChatController, createWebSessionController } from "./web-chat-controller"
import { createWebSelectionController } from "./web-selection-controller"

/**
 * WebChatContextProvider — wires the abstract ChatController/SessionController/
 * SelectionController interfaces to the web app's useSync/useSDK/useLocal
 * implementations.
 *
 * Must be nested inside SDKProvider + SyncProvider + LocalProvider
 * (which provide the underlying contexts this adapter reads from).
 */
export function WebChatContextProvider(props: ParentProps) {
  const chat = createWebChatController()
  const session = createWebSessionController()
  const selection = createWebSelectionController()

  return (
    <ChatContextProvider chat={chat} session={session} selection={selection}>
      {props.children}
    </ChatContextProvider>
  )
}
