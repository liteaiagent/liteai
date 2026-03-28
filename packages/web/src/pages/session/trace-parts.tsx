import { IconButton } from "@liteai/ui/icon-button"
import { Markdown } from "@liteai/ui/markdown"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { Section } from "./trace-section"
import type { TraceMessageData, TracePartData } from "./trace-types"

export function SyntheticContent(props: { text: string }) {
  const [expanded, setExpanded] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  const cleanText = createMemo(() => {
    let t = props.text.trim()
    if (t.startsWith("<system-reminder>")) {
      t = t.replace(/^<system-reminder>\s*/, "").replace(/\s*<\/system-reminder>$/, "")
    }
    return t
  })

  const copy = () => {
    navigator.clipboard.writeText(cleanText())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <div class="trace-sys-header" style={{ "margin-bottom": "8px", "margin-top": "8px" }}>
        <button
          type="button"
          class="trace-msg-role trace-msg-role--system"
          style={{ cursor: "pointer", border: "none", background: "none", padding: 0 }}
          onClick={() => setExpanded(!expanded())}
        >
          {expanded() ? "▼" : "▶"} SYSTEM INJECTED
        </button>
        <Show when={expanded()}>
          <IconButton icon={copied() ? "check" : "copy"} size="small" variant="ghost" title="Copy" onClick={copy} />
        </Show>
      </div>
      <Show when={expanded()}>
        <div class="trace-sys-box">
          <Markdown text={cleanText()} />
        </div>
      </Show>
    </>
  )
}

export function ReasoningContent(props: { text: string }) {
  const [copied, setCopied] = createSignal(false)

  const copy = () => {
    navigator.clipboard.writeText(props.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div class="trace-msg-reasoning">
      <div class="trace-sys-header" style={{ "margin-bottom": "8px" }}>
        <span class="trace-msg-reasoning-label" style={{ "margin-bottom": "0" }}>
          💭 Reasoning
        </span>
        <IconButton icon={copied() ? "check" : "copy"} size="small" variant="ghost" title="Copy" onClick={copy} />
      </div>
      <div class="trace-msg-text" style={{ "max-height": "300px", "overflow-y": "auto", "padding-right": "4px" }}>
        <Markdown text={props.text} />
      </div>
    </div>
  )
}

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

export function HookCard(props: { hook: Record<string, unknown> }) {
  const [open, setOpen] = createSignal(false)
  const event = () => (props.hook.event as string) ?? "Unknown"
  const type = () => (props.hook.type as string) ?? "unknown"
  const config = () => props.hook.config as Record<string, unknown> | undefined
  const context = () => props.hook.context as string | undefined

  return (
    <div class="trace-tool">
      <button type="button" class="trace-tool-head" onClick={() => setOpen(!open())}>
        <span>{open() ? "▼" : "▶"}</span>
        <span class="trace-tool-name">
          {event()} ({type()})
        </span>
      </button>
      <Show when={open()}>
        <div class="trace-tool-body">
          <Show when={config()}>
            <div class="trace-tool-section-label">Config</div>
            <pre class="trace-code">{JSON.stringify(config(), null, 2)}</pre>
          </Show>
          <Show when={context()}>
            <div class="trace-tool-section-label">Injected Context</div>
            <pre class="trace-code">{context()}</pre>
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
                  <ReasoningContent text={part.text as string} />
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
    return props.ids
      .map((id) => {
        const msg = map.get(id)
        if (!msg) return null
        return {
          msg,
          parts: (sync.data.part[id] ?? []) as TracePartData[],
        }
      })
      .filter((m): m is NonNullable<typeof m> => !!m)
  })

  return (
    <For each={resolved()}>
      {({ msg, parts }) => {
        const role = msg.role ?? "unknown"
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
            <For each={parts}>
              {(part) => (
                <>
                  <Show when={part.type === "text" && part.text}>
                    <div class="trace-msg-text">
                      <Show when={part.synthetic} fallback={part.text}>
                        <SyntheticContent text={part.text ?? ""} />
                      </Show>
                    </div>
                  </Show>
                  <Show when={part.type === "reasoning" && part.text}>
                    <ReasoningContent text={part.text as string} />
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
                  <Show when={part.type === "agent" && !part.synthetic}>
                    <div class="trace-msg-text">
                      <div
                        class="trace-tool-section-label"
                        style="display:inline-block; margin-right:6px; color: var(--trace-color-agent); border: 1px solid var(--trace-color-agent); padding: 2px 6px; border-radius: 4px; font-size: 10px;"
                      >
                        AGENT DELEGATION
                      </div>
                      Use {part.name}
                    </div>
                  </Show>
                  <Show when={part.type === "subtask"}>
                    <div class="trace-msg-text">
                      <div
                        class="trace-tool-section-label"
                        style="display:inline-block; margin-right:6px; color: var(--trace-color-agent); border: 1px solid var(--trace-color-agent); padding: 2px 6px; border-radius: 4px; font-size: 10px;"
                      >
                        SUBTASK RESULT
                      </div>
                      The following tool was executed by the user
                    </div>
                  </Show>
                  <Show when={part.type === "compaction"}>
                    <div class="trace-msg-text">
                      <div
                        class="trace-tool-section-label"
                        style="display:inline-block; margin-right:6px; color: var(--trace-color-agent); border: 1px solid var(--trace-color-agent); padding: 2px 6px; border-radius: 4px; font-size: 10px;"
                      >
                        COMPACTION
                      </div>
                      What did we do so far?
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
