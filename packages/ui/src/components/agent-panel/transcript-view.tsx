import { createEffect, createMemo, For, on, Show } from "solid-js"
import { useChatController } from "../../panes/controllers"
import { useAgentPanel } from "./agent-panel"
import "./transcript-view.css"

export interface TranscriptViewProps {
  agentId: string
}

export function TranscriptView(props: TranscriptViewProps) {
  const ctx = useAgentPanel()
  if (!ctx) {
    // Defensive: should never happen if wrapped by AgentPanelContext.Provider
    console.error("TranscriptView rendered outside AgentPanelProvider")
    return <div class="transcript-view">Missing agent panel context.</div>
  }
  const [, setPanel] = ctx
  const controller = useChatController()

  // Sync the agent session to get its messages
  createEffect(
    on(
      () => props.agentId,
      (id) => {
        if (!id) return
        void controller.session.sync(id)
      },
    ),
  )

  const messages = createMemo(() => controller.messages(props.agentId))
  const messagesReady = createMemo(() => controller.messagesReady(props.agentId))

  const handleBack = () => {
    setPanel("selectedAgentId", undefined)
  }

  return (
    <div class="transcript-view">
      <div class="transcript-header">
        <button type="button" class="transcript-back-btn" onClick={handleBack}>
          ← Back to agents
        </button>
      </div>

      <Show when={messagesReady()} fallback={<div class="transcript-loading">Loading transcript...</div>}>
        <div class="transcript-body">
          <For each={messages()}>
            {(msg) => {
              const parts = createMemo(() => controller.parts(msg.id))
              // Basic concatenating of parts for simplified rendering
              const content = createMemo(() =>
                parts()
                  .map((p) => {
                    if ("text" in p && typeof p.text === "string") return p.text
                    if ("tool" in p && typeof p.tool === "string") return `[Tool: ${p.tool}]`
                    return ""
                  })
                  .join("\n"),
              )

              return (
                <div class="transcript-message" data-role={msg.role}>
                  <div class="transcript-message-header">{msg.role}</div>
                  <div class="transcript-message-content">{content()}</div>
                </div>
              )
            }}
          </For>
          <Show when={messages().length === 0}>
            <div class="transcript-loading">No messages yet.</div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
