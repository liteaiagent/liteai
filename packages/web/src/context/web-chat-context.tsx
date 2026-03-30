import { ChatContextProvider } from "@liteai/ui/panes"
import type { ParentProps } from "solid-js"
import { createWebChatController, createWebSessionController } from "./web-chat-controller"

/**
 * WebChatContextProvider — wires the abstract ChatController/SessionController
 * interfaces to the web app's useSync/useSDK implementation.
 *
 * Must be nested inside SDKProvider + SyncProvider (which provide the underlying
 * sync/sdk contexts this adapter reads from).
 */
export function WebChatContextProvider(props: ParentProps) {
  const chat = createWebChatController()
  const session = createWebSessionController()

  return (
    <ChatContextProvider chat={chat} session={session}>
      {props.children}
    </ChatContextProvider>
  )
}
