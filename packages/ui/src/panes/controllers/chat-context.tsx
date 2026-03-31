import { createContext, type ParentProps, useContext } from "solid-js"
import type { ChatController } from "./chat-controller"
import type { PermissionController } from "./permission-controller"
import type { SelectionController } from "./selection-controller"
import type { SessionController } from "./session-controller"

/**
 * ChatContext — provides ChatController + SessionController + SelectionController
 * + PermissionController to chat components.
 *
 * Host platforms create their own implementations of these interfaces
 * and wrap the chat UI with this provider. This replaces direct
 * `useSync()` / `useSDK()` / `useLocal()` calls in component bodies.
 */

type ChatContextValue = {
  chat: ChatController
  session: SessionController
  selection: SelectionController
  permission?: PermissionController
}

const ChatContext = createContext<ChatContextValue>()

/** Provider component — wraps chat UI with controller implementations. */
export function ChatContextProvider(
  props: ParentProps<{
    chat: ChatController
    session: SessionController
    selection: SelectionController
    permission?: PermissionController
  }>,
) {
  const value: ChatContextValue = {
    get chat() {
      return props.chat
    },
    get session() {
      return props.session
    },
    get selection() {
      return props.selection
    },
    get permission() {
      return props.permission
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

/** Access the SelectionController from context. */
export function useSelectionController(): SelectionController {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error("useSelectionController must be used within a ChatContextProvider")
  return ctx.selection
}

/** No-op PermissionController for platforms without auto-accept support. */
const NOOP_PERMISSION: PermissionController = {
  isAutoAccepting: () => false,
  toggle: () => {},
}

/** Access the PermissionController from context. Falls back to no-op if not provided. */
export function usePermissionController(): PermissionController {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error("usePermissionController must be used within a ChatContextProvider")
  return ctx.permission ?? NOOP_PERMISSION
}
