import type { Message, Part } from "@liteai/sdk"
import { AssistantMessageContent, UserMessageContent } from "./message"

type Props = {
  message: Message
  parts: Part[]
  index: number
  last: boolean
}

export function MessageRow({ message, parts, index, last }: Props) {
  if (message.role === "user") {
    return <UserMessageContent message={message} parts={parts} index={index} />
  }

  if (message.role === "assistant") {
    return <AssistantMessageContent message={message} parts={parts} last={last} />
  }

  return null
}
