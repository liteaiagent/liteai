import type { Message } from "@liteai/sdk"
import type { UILocalPart } from "../../utils/collapse-tool-groups"
import { AssistantMessageContent, UserMessageContent } from "./message"

type Props = {
  message: Message
  parts: UILocalPart[]
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
