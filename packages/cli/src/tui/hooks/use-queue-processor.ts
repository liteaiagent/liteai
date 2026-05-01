import { useEffect, useSyncExternalStore } from "react"
import { dequeueAll, getSnapshot, isEmpty, subscribe } from "../stores/message-queue-store"
import type { PromptInputMode } from "../types/text-input"

export function useQueueProcessor(opts: {
  sessionStatus: "idle" | "compacting" | "working" | "planning" | "working_subagent"
  submit: (text: string, mode: PromptInputMode) => Promise<void>
}): void {
  const queue = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    if (opts.sessionStatus !== "idle") return
    if (isEmpty()) return

    const items = dequeueAll()
    if (items.length === 0) return

    // Join all queued messages and submit as one
    const combinedText = items.map((m) => m.text).join("\n\n")
    const mode = items[0]?.mode ?? "prompt"
    void opts.submit(combinedText, mode)
  }, [opts.sessionStatus, queue, opts.submit])
}
