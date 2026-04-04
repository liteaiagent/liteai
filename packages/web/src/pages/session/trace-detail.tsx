import { IconButton } from "@liteai/ui/icon-button"
import { Markdown } from "@liteai/ui/markdown"
import { RadioGroup } from "@liteai/ui/radio-group"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { fmt, SPAN_COLORS, spanType } from "./trace-helpers"
import { ContextMessages, HookCard, OutputParts, ToolCard } from "./trace-parts"
import { Section } from "./trace-section"
import type { TraceDetail, TraceMessageData, TracePartData } from "./trace-types"

export function TraceDetailView(props: {
  detail: TraceDetail
  tab: "run" | "prompts" | "attributes" | "messages"
  setTab: (tab: "run" | "prompts" | "attributes" | "messages") => void
  messages: TraceMessageData[]
  tokens?: {
    tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    cost: number
  }
}) {
  const sync = useSync()
  const type = () => spanType(props.detail)
  const color = () => SPAN_COLORS[type()] ?? SPAN_COLORS.default
  const dur = () => (props.detail.timeEnd ? fmt((props.detail.timeEnd as number) - props.detail.timeStart) : "running")

  const exportJSON = () => {
    const contextMessages = props.detail.contextIDs
      ?.map((id) => props.messages.find((m) => m.id === id))
      .filter((m): m is TraceMessageData => !!m)
      .map((m) => ({
        ...m,
        parts: sync.data.part[m.id] ?? [],
      }))

    const outputMessage = props.messages.find((m) => m.id === props.detail.messageID)
    const outputMessageWithParts = outputMessage
      ? { ...outputMessage, parts: sync.data.part[outputMessage.id] ?? [] }
      : undefined

    const exportData = {
      ...props.detail,
      messages: contextMessages,
      output: outputMessageWithParts,
    }
    const data = JSON.stringify(exportData, null, 2)
    const blob = new Blob([data], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `trace-${props.detail.id}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const exportMD = () => {
    let md = `# Trace: ${props.detail.agent} - ${props.detail.providerID}/${props.detail.modelID}\n\n`
    if (props.tokens) {
      md += `**Tokens:** Input: ${props.tokens.tokens.input}, Output: ${props.tokens.tokens.output}, Reasoning: ${props.tokens.tokens.reasoning}\n\n`
    }
    if (props.detail.error) {
      md += `## Error\n\`\`\`\n${props.detail.error}\n\`\`\`\n\n`
    }

    if (props.detail.system) {
      md += `## System Prompt\n\n${props.detail.system}\n\n`
    }

    if (props.detail.tools && props.detail.tools.length > 0) {
      md += `## Tools (${props.detail.tools.length})\n\n`
      for (const tool of props.detail.tools) {
        const name = (tool as Record<string, unknown>).name ?? "tool"
        md += `### ${name}\n\n\`\`\`json\n${JSON.stringify(tool, null, 2)}\n\`\`\`\n\n`
      }
    }

    const contextMessages = props.detail.contextIDs
      ?.map((id) => props.messages.find((m) => m.id === id))
      .filter((m): m is TraceMessageData => !!m)
      .map((m) => ({ ...m, parts: sync.data.part[m.id] ?? [] }))

    if (contextMessages && contextMessages.length > 0) {
      md += `## Context Messages\n\n`
      for (const msg of contextMessages) {
        md += `### ${msg.role?.toUpperCase() || "UNKNOWN"}\n\n`
        for (const part of msg.parts as TracePartData[]) {
          if (part.type === "text" && part.text) {
            md += `${part.text}\n\n`
          } else if (part.type === "reasoning" && part.text) {
            md += `*Reasoning:*\n> ${part.text.split("\n").join("\n> ")}\n\n`
          } else if (part.type === "tool-call") {
            const args = typeof part.args === "string" ? part.args : JSON.stringify(part.args, null, 2)
            md += `**Tool Call:** \`${part.toolName || "tool"}\`\n\`\`\`json\n${args}\n\`\`\`\n\n`
          } else if (part.type === "tool-result") {
            const result = typeof part.result === "string" ? part.result : JSON.stringify(part.result, null, 2)
            md += `**Tool Result:** \`${part.toolName || "tool"}\`\n\`\`\`\n${result}\n\`\`\`\n\n`
          } else if (part.type === "tool") {
            const input =
              typeof part.state?.input === "string" ? part.state?.input : JSON.stringify(part.state?.input, null, 2)
            const output =
              typeof part.state?.output === "string" ? part.state?.output : JSON.stringify(part.state?.output, null, 2)
            md += `**Tool Call:** \`${part.tool || "tool"}\`\n\`\`\`json\n${input}\n\`\`\`\n\n`
            md += `**Tool Result:**\n\`\`\`\n${output}\n\`\`\`\n\n`
          }
        }
      }
    }

    const outputMessage = props.messages.find((m) => m.id === props.detail.messageID)
    const outputParts = outputMessage ? ((sync.data.part[outputMessage.id] ?? []) as TracePartData[]) : []

    if (outputParts.length > 0) {
      md += `## Output\n\n`
      for (const part of outputParts) {
        if (part.type === "text" && part.text) {
          md += `${part.text}\n\n`
        } else if (part.type === "reasoning" && part.text) {
          md += `*Reasoning:*\n> ${part.text.split("\n").join("\n> ")}\n\n`
        } else if (part.type === "tool-call") {
          const args = typeof part.args === "string" ? part.args : JSON.stringify(part.args, null, 2)
          md += `**Tool Call:** \`${part.toolName || "tool"}\`\n\`\`\`json\n${args}\n\`\`\`\n\n`
        } else if (part.type === "tool-result") {
          const result = typeof part.result === "string" ? part.result : JSON.stringify(part.result, null, 2)
          md += `**Tool Result:** \`${part.toolName || "tool"}\`\n\`\`\`\n${result}\n\`\`\`\n\n`
        } else if (part.type === "tool") {
          const input =
            typeof part.state?.input === "string" ? part.state?.input : JSON.stringify(part.state?.input, null, 2)
          const output =
            typeof part.state?.output === "string" ? part.state?.output : JSON.stringify(part.state?.output, null, 2)
          md += `**Tool Call:** \`${part.tool || "tool"}\`\n\`\`\`json\n${input}\n\`\`\`\n\n`
          md += `**Tool Result:**\n\`\`\`\n${output}\n\`\`\`\n\n`
        }
      }
    }

    const blob = new Blob([md], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `trace-${props.detail.id}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div class="trace-detail-header">
        <span class="trace-detail-type" style={{ background: color() }}>
          {type().toUpperCase()}
        </span>
        <span class="trace-detail-agent">{props.detail.agent}</span>
        <span class="trace-detail-name">
          {props.detail.providerID}/{props.detail.modelID}
        </span>
        <Show when={props.tokens}>
          {(tk) => <span class="trace-detail-badge">🔄 {tk().tokens.input + tk().tokens.output}</span>}
        </Show>
        <span class="trace-detail-badge">{dur()}</span>
        <Show when={props.detail.error}>
          <span class="trace-detail-badge trace-detail-badge--error">Error</span>
        </Show>
        <div class="ml-auto flex items-center gap-1">
          <IconButton icon="code" title="Export Markdown" onClick={exportMD} />
          <IconButton icon="download" title="Export JSON" onClick={exportJSON} />
        </div>
      </div>

      <div class="trace-detail-tabs">
        <button
          type="button"
          class="trace-dtab"
          classList={{ "trace-dtab--active": props.tab === "run" }}
          onClick={() => props.setTab("run")}
        >
          Run
        </button>
        <button
          type="button"
          class="trace-dtab"
          classList={{ "trace-dtab--active": props.tab === "prompts" }}
          onClick={() => props.setTab("prompts")}
        >
          System Prompt
        </button>
        <button
          type="button"
          class="trace-dtab"
          classList={{ "trace-dtab--active": props.tab === "attributes" }}
          onClick={() => props.setTab("attributes")}
        >
          Attributes
        </button>
        <button
          type="button"
          class="trace-dtab"
          classList={{ "trace-dtab--active": props.tab === "messages" }}
          onClick={() => props.setTab("messages")}
        >
          Raw Messages
        </button>
      </div>

      <div class="trace-detail-body">
        <Show when={props.tab === "run"}>
          <Show when={props.detail.error}>
            {(err) => {
              const [copied, setCopied] = createSignal(false)
              const copy = () => {
                navigator.clipboard.writeText(err())
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }
              return (
                <div class="trace-error-block">
                  <div class="trace-error-header">
                    <div class="trace-error-title">Error</div>
                    <button type="button" class="trace-error-copy" onClick={copy}>
                      {copied() ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <pre class="trace-code">{err()}</pre>
                </div>
              )
            }}
          </Show>

          <Show when={(props.detail.tools?.length ?? 0) > 0}>
            <Section title={`Functions (${props.detail.tools?.length})`}>
              <For each={props.detail.tools ?? []}>{(tool) => <ToolCard tool={tool} />}</For>
            </Section>
          </Show>

          <Show when={(props.detail.hooks?.length ?? 0) > 0}>
            <Section title={`Hooks (${props.detail.hooks?.length})`}>
              <For each={props.detail.hooks ?? []}>{(hook) => <HookCard hook={hook} />}</For>
            </Section>
          </Show>

          <Section
            title="Input"
            extra={
              <>
                <span class="trace-section-meta">Message</span>
                <Show when={props.detail.modelID}>
                  <span class="trace-model-badge">⚡ {props.detail.modelID}</span>
                </Show>
              </>
            }
          >
            <Show when={props.detail.system}>
              {(sys) => {
                const [expanded, setExpanded] = createSignal(false)
                const [copied, setCopied] = createSignal(false)
                const [mode, setMode] = createSignal<"preview" | "code">("preview")
                const copy = () => {
                  navigator.clipboard.writeText(sys())
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }
                return (
                  <div class="trace-msg">
                    <div class="trace-sys-header">
                      <button
                        type="button"
                        class="trace-msg-role trace-msg-role--system"
                        style={{ cursor: "pointer", border: "none", background: "none", padding: 0 }}
                        onClick={() => setExpanded(!expanded())}
                      >
                        {expanded() ? "▼" : "▶"} SYSTEM
                      </button>
                      <Show when={expanded()}>
                        <div style={{ "margin-left": "auto", display: "flex", "align-items": "center", gap: "8px" }}>
                          <RadioGroup
                            options={["preview", "code"] as const}
                            current={mode()}
                            size="small"
                            value={(v) => v}
                            label={(v) => (v === "preview" ? "Preview" : "Code")}
                            onSelect={(v) => {
                              if (v) setMode(v)
                            }}
                          />
                          <IconButton
                            icon={copied() ? "check" : "copy"}
                            size="small"
                            variant="ghost"
                            title="Copy"
                            onClick={copy}
                          />
                        </div>
                      </Show>
                    </div>
                    <Show when={expanded()}>
                      <div class="trace-sys-box">
                        <Show
                          when={mode() === "preview"}
                          fallback={
                            <div style={{ "font-family": "var(--font-family-mono)", "white-space": "pre-wrap" }}>
                              {sys()}
                            </div>
                          }
                        >
                          <Markdown text={sys()} />
                        </Show>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </Show>
            <ContextMessages ids={props.detail.contextIDs} messages={props.messages} />
          </Section>

          <OutputParts messageID={props.detail.messageID} messages={props.messages} />

          <Show when={props.tokens}>
            {(tk) => (
              <Section title="Token Usage">
                <div class="trace-usage-grid">
                  <div class="trace-usage-item">
                    <div class="trace-usage-label">Input</div>
                    <div class="trace-usage-val">{tk().tokens.input.toLocaleString()}</div>
                  </div>
                  <div class="trace-usage-item">
                    <div class="trace-usage-label">Output</div>
                    <div class="trace-usage-val">{tk().tokens.output.toLocaleString()}</div>
                  </div>
                  <div class="trace-usage-item">
                    <div class="trace-usage-label">Reasoning</div>
                    <div class="trace-usage-val">{tk().tokens.reasoning.toLocaleString()}</div>
                  </div>
                  <div class="trace-usage-item">
                    <div class="trace-usage-label">Cache Read</div>
                    <div class="trace-usage-val">{tk().tokens.cache.read.toLocaleString()}</div>
                  </div>
                  <div class="trace-usage-item">
                    <div class="trace-usage-label">Cache Write</div>
                    <div class="trace-usage-val">{tk().tokens.cache.write.toLocaleString()}</div>
                  </div>
                  <div class="trace-usage-item trace-usage-item--highlight">
                    <div class="trace-usage-label">Cost</div>
                    <div class="trace-usage-val">${tk().cost.toFixed(4)}</div>
                  </div>
                </div>
              </Section>
            )}
          </Show>
        </Show>

        <Show when={props.tab === "prompts"}>
          <Show when={props.detail.system} fallback={<div class="trace-empty-text">No system prompt</div>}>
            {(sys) => (
              <div class="trace-msg">
                <div class="trace-msg-text">
                  <Markdown text={sys()} />
                </div>
              </div>
            )}
          </Show>
        </Show>

        <Show when={props.tab === "attributes"}>
          <Section title="Parameters">
            <Show when={props.detail.params} fallback={<div class="trace-empty-text">No parameters</div>}>
              {(p) => (
                <div class="trace-attrs">
                  <For each={Object.entries(p()).filter(([, v]) => v !== undefined && v !== null)}>
                    {([k, v]) => (
                      <div class="trace-attr-row">
                        <span class="trace-attr-key">{k}</span>
                        <span class="trace-attr-val">{String(v)}</span>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </Section>
          <Section title="Metadata">
            <div class="trace-attrs">
              <div class="trace-attr-row">
                <span class="trace-attr-key">agent</span>
                <span class="trace-attr-val">{props.detail.agent}</span>
              </div>
              <div class="trace-attr-row">
                <span class="trace-attr-key">provider</span>
                <span class="trace-attr-val">{props.detail.providerID}</span>
              </div>
              <div class="trace-attr-row">
                <span class="trace-attr-key">model</span>
                <span class="trace-attr-val">{props.detail.modelID}</span>
              </div>
              <div class="trace-attr-row">
                <span class="trace-attr-key">step</span>
                <span class="trace-attr-val">{props.detail.step}</span>
              </div>
              <div class="trace-attr-row">
                <span class="trace-attr-key">context_size</span>
                <span class="trace-attr-val">{props.detail.contextSize}</span>
              </div>
            </div>
          </Section>
        </Show>

        <Show when={props.tab === "messages"}>
          <div style={{ padding: "12px 16px" }}>
            <Show
              when={props.detail.contextIDs?.length || props.detail.messageID}
              fallback={<div class="trace-empty-text">No context messages</div>}
            >
              {(() => {
                const ids = createMemo(() => {
                  const ctx = props.detail.contextIDs ?? []
                  const out = props.detail.messageID
                  if (!out || ctx.includes(out)) return ctx
                  return [...ctx, out]
                })
                return (
                  <For each={ids()}>
                    {(id) => {
                      const msg = () => props.messages.find((m) => m.id === id)
                      const parts = () =>
                        msg() ? ((sync.data.part[msg()?.id as string] ?? []) as TracePartData[]) : []
                      const json = () => JSON.stringify({ message: msg(), parts: parts() }, null, 2)
                      const [open, setOpen] = createSignal(false)
                      return (
                        <Show when={msg()}>
                          {(m) => (
                            <div class="trace-raw-msg">
                              <button type="button" class="trace-raw-msg-head" onClick={() => setOpen(!open())}>
                                <span>
                                  {open() ? "▼" : "▶"} {m().role?.toUpperCase() ?? "UNKNOWN"}
                                </span>
                                <span class="trace-raw-msg-meta">{m().id}</span>
                              </button>
                              <Show when={open()}>
                                <div class="trace-raw-msg-body">
                                  <pre class="trace-code">{json()}</pre>
                                </div>
                              </Show>
                            </div>
                          )}
                        </Show>
                      )
                    }}
                  </For>
                )
              })()}
            </Show>
          </div>
        </Show>
      </div>
    </>
  )
}
