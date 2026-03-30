import { createContext, type ParentProps, useContext } from "solid-js"
import type { ChatController } from "./chat-controller"
import type { SessionController } from "./session-controller"

/**
 * ChatContext — provides ChatController + SessionController to chat components.
 *
 * Host platforms create their own implementations of these interfaces
 * and wrap the chat UI with this provider. This replaces direct
 * `useSync()` / `useSDK()` calls in component bodies.
 */

type ChatContextValue = {
  chat: ChatController
  session: SessionController
}

const ChatContext = createContext<ChatContextValue>()

/** Provider component — wraps chat UI with controller implementations. */
export function ChatContextProvider(
  props: ParentProps<{
    chat: ChatController
    session: SessionController
  }>,
) {
  const value: ChatContextValue = {
    get chat() {
      return props.chat
    },
    get session() {
      return props.session
    },
  }

  return <ChatContext.Provider value={value}>{props.children}</ChatContext.Provider>
}

/** Access the ChatController from context. */
export function useChatController(): ChatController {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error("useChatController must be used within a ChatContextProvider")
  return ctx.chat
}

/** Access the SessionController from context. */
export function useSessionController(): SessionController {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error("useSessionController must be used within a ChatContextProvider")
  return ctx.session
}
