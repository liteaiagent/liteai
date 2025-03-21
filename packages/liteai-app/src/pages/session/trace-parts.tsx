import { createMemo, createSignal, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { Section } from "./trace-section"
import type { TraceMessageData, TracePartData } from "./trace-types"

export function ToolCard(props: { tool: Record<string, unknown> }) {
  const [open, setOpen] = createSignal(false)
  const name = () => (props.tool.name as string) ?? "Unknown"
  const desc = () => props.tool.description as string | undefined
  const params = () => props.tool.parameters as Record<string, unknown> | undefined

  return (
    <div class="trace-tool">
      <button type="button" class="trace-tool-head" onClick={() => setOpen(!open())}>
        <span>{open() ? "▼" : "▶"}</span>
        <span class="trace-tool-name">{name()}</span>
      </button>
      <Show when={open()}>
        <div class="trace-tool-body">
          <Show when={desc()}>
            <div class="trace-tool-desc">{desc()}</div>
          </Show>
          <Show when={params()}>
            <pre class="trace-code">{JSON.stringify(params(), null, 2)}</pre>
          </Show>
        </div>
      </Show>
    </div>
  )
}

export function OutputParts(props: { messageID: string; messages: TraceMessageData[] }) {
  const sync = useSync()
  const msg = createMemo(() => props.messages.find((m) => m.id === props.messageID))
  const parts = createMemo(() => {
    const m = msg()
    if (!m) return []
    return (sync.data.part[m.id] ?? []) as TracePartData[]
  })
  const steps = createMemo(() => parts().filter((p) => p.type === "step-start").length)

  let step = 0

  return (
    <Show when={parts().length > 0}>
      <Section title="Output">
        <For each={parts()}>
          {(part) => {
            if (part.type === "step-start") step++
            return (
              <>
                <Show when={part.type === "step-start"}>
                  <div class="trace-step-sep">
                    <span class="trace-step-sep-line" />
                    <span class="trace-step-sep-label">
                      Step {step}
                      {steps() > 1 ? ` / ${steps()}` : ""}
                    </span>
                    <span class="trace-step-sep-line" />
                  </div>
                </Show>
                <Show when={part.type === "text" && part.text}>
                  <div class="trace-msg-text">{part.text}</div>
                </Show>
                <Show when={part.type === "reasoning" && part.text}>
                  <div class="trace-msg-reasoning">
                    <span class="trace-msg-reasoning-label">💭 Reasoning</span>
                    <div class="trace-msg-text">{part.text}</div>
                  </div>
                </Show>
                <Show when={part.type === "tool-call"}>
                  <div class="trace-msg-toolcall">
                    <span class="trace-msg-toolcall-label">🔧 {part.toolName ?? "tool"}</span>
                    <Show when={part.args}>
                      <pre class="trace-code">
                        {typeof part.args === "string" ? part.args : JSON.stringify(part.args, null, 2)}
                      </pre>
                    </Show>
                  </div>
                </Show>
                <Show when={part.type === "tool-result"}>
                  <div class="trace-msg-toolresult">
                    <span class="trace-msg-toolresult-label">📋 Result: {part.toolName ?? "tool"}</span>
                    <Show when={part.result}>
                      <pre class="trace-code">
                        {typeof part.result === "string" ? part.result : JSON.stringify(part.result, null, 2)}
                      </pre>
                    </Show>
                  </div>
                </Show>
                <Show when={part.type === "tool"}>
                  <div class="trace-msg-toolcall">
                    <span class="trace-msg-toolcall-label">
                      🔧 {part.tool ?? "tool"}
                      {part.state?.title ? ` — ${part.state.title}` : ""}
                    </span>
                    <Show when={part.state?.input}>
                      <div class="trace-tool-section-label">Call</div>
                      <pre class="trace-code">{JSON.stringify(part.state?.input, null, 2)}</pre>
                    </Show>
                    <Show when={part.state?.output}>
                      <div class="trace-tool-section-label">Result</div>
                      <pre class="trace-code">
                        {typeof part.state?.output === "string"
                          ? part.state?.output
                          : JSON.stringify(part.state?.output, null, 2)}
                      </pre>
                    </Show>
                  </div>
                </Show>
                <Show when={part.type === "step-finish"}>
                  <div class="trace-step-finish">
                    <Show when={part.reason}>
                      <span class={`trace-step-finish-reason trace-step-finish-reason--${part.reason}`}>
                        {part.reason}
                      </span>
                    </Show>
                    <Show when={part.tokens}>
                      <span class="trace-step-finish-tokens">
                        {part.tokens?.input}→{part.tokens?.output} tokens
                      </span>
                      <Show when={(part.tokens?.reasoning ?? 0) > 0}>
                        <span class="trace-step-finish-tokens">💭 {part.tokens?.reasoning}</span>
                      </Show>
                    </Show>
                  </div>
                </Show>
              </>
            )
          }}
        </For>
      </Section>
    </Show>
  )
}

export function ContextMessages(props: { ids: string[]; messages: TraceMessageData[] }) {
  const sync = useSync()
  const resolved = createMemo(() => {
    const map = new Map(props.messages.map((m) => [m.id, m]))
    return props.ids.map((id) => map.get(id)).filter((m): m is TraceMessageData => !!m)
  })

  return (
    <For each={resolved()}>
      {(msg) => {
        const role = msg.role ?? "unknown"
        const parts = () => (sync.data.part[msg.id] ?? []) as TracePartData[]
        return (
          <div class="trace-msg">
            <span
              class="trace-msg-role"
              classList={{
                "trace-msg-role--user": role === "user",
                "trace-msg-role--assistant": role === "assistant",
                "trace-msg-role--system": role === "system",
              }}
            >
              {role.toUpperCase()}
            </span>
            <For each={parts()}>
              {(part) => (
                <>
                  <Show when={part.type === "text" && part.text}>
                    <div class="trace-msg-text">{part.text}</div>
                  </Show>
                  <Show when={part.type === "reasoning" && part.text}>
                    <div class="trace-msg-reasoning">
                      <span class="trace-msg-reasoning-label">💭 Reasoning</span>
                      <div class="trace-msg-text">{part.text}</div>
                    </div>
                  </Show>
                  <Show when={part.type === "tool-call"}>
                    <div class="trace-msg-toolcall">
                      <span class="trace-msg-toolcall-label">🔧 {part.toolName ?? "tool"}</span>
                      <Show when={part.args}>
                        <pre class="trace-code">
                          {typeof part.args === "string" ? part.args : JSON.stringify(part.args, null, 2)}
                        </pre>
                      </Show>
                    </div>
                  </Show>
                  <Show when={part.type === "tool-result"}>
                    <div class="trace-msg-toolresult">
                      <span class="trace-msg-toolresult-label">📋 Result: {part.toolName ?? "tool"}</span>
                      <Show when={part.result}>
                        <pre class="trace-code">
                          {typeof part.result === "string" ? part.result : JSON.stringify(part.result, null, 2)}
                        </pre>
                      </Show>
                    </div>
                  </Show>
                  <Show when={part.type === "tool"}>
                    <div class="trace-msg-toolcall">
                      <span class="trace-msg-toolcall-label">
                        🔧 {part.tool ?? "tool"}
                        {part.state?.title ? ` — ${part.state.title}` : ""}
                      </span>
                      <Show when={part.state?.input}>
                        <div class="trace-tool-section-label">Call</div>
                        <pre class="trace-code">{JSON.stringify(part.state?.input, null, 2)}</pre>
                      </Show>
                      <Show when={part.state?.output}>
                        <div class="trace-tool-section-label">Result</div>
                        <pre class="trace-code">
                          {typeof part.state?.output === "string"
                            ? part.state?.output
                            : JSON.stringify(part.state?.output, null, 2)}
                        </pre>
                      </Show>
                    </div>
                  </Show>
                </>
              )}
            </For>
          </div>
        )
      }}
    </For>
  )
}
