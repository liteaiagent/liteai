import type { ScrollBoxHandle } from "@liteai/ink"
import type { Message } from "@liteai/sdk"
import type React from "react"
import { useCallback } from "react"
import { VirtualMessageList } from "../../components/virtual-message-list"
import { useSync } from "../../context/sync"
import { useSessionContext } from "./ctx"
import { MessageRow } from "./message-row"

export function Messages({ scrollRef }: { scrollRef: React.RefObject<ScrollBoxHandle | null> }) {
  const ctx = useSessionContext()
  const sync = useSync()
  const messages = sync.message[ctx.sessionID] ?? []

  const itemKey = useCallback((msg: Message) => msg.id, [])

  const renderItem = useCallback(
    (msg: Message, index: number) => {
      const parts = sync.part[msg.id] ?? []
      return <MessageRow key={msg.id} message={msg} parts={parts} index={index} last={index === messages.length - 1} />
    },
    [sync.part, messages.length],
  )

  return (
    <VirtualMessageList
      messages={messages}
      scrollRef={scrollRef}
      columns={ctx.width}
      itemKey={itemKey}
      renderItem={renderItem}
      trackStickyPrompt={true}
    />
  )
}
