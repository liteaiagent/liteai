import { createContext, useContext } from "react"

export type MessageCursorContextValue = {
  /** ID of the currently selected message, or undefined */
  selectedMessageId: string | undefined
  /** Whether a message is expanded in cursor mode */
  isExpanded: (messageId: string) => boolean
  /** Jump directly to a specific message */
  selectMessage?: (messageId: string) => void
}

export const MessageCursorContext = createContext<MessageCursorContextValue>({
  selectedMessageId: undefined,
  isExpanded: () => false,
})

export function useMessageCursorContext() {
  return useContext(MessageCursorContext)
}
