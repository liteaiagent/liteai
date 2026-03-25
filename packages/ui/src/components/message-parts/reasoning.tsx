import type { ReasoningPart } from "@liteai-ai/sdk"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useI18n } from "../../context/i18n"
import { Collapsible } from "../collapsible"
import { Icon } from "../icon"
import { Markdown } from "../markdown"
import type { MessagePartProps } from "../message-part"
import { createThrottledValue } from "../message-utils"
import { TextShimmer } from "../text-shimmer"

function stripMarkdown(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim()
}

function lastMatch(text: string, re: RegExp) {
  let last: RegExpExecArray | null = null
  for (const m of text.matchAll(re)) last = m
  return last
}

function reasoningTitle(text: string) {
  const md = text.replace(/\r\n?/g, "\n")

  const html = lastMatch(md, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)
  if (html?.[1]) {
    const value = stripMarkdown(html[1].replace(/<[^>]+>/g, " "))
    if (value) return value
  }

  const atx = lastMatch(md, /^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/gm)
  if (atx?.[1]) {
    const value = stripMarkdown(atx[1])
    if (value) return value
  }

  const setext = lastMatch(md, /^([^\n]+)\n(?:=+|-+)\s*$/gm)
  if (setext?.[1]) {
    const value = stripMarkdown(setext[1])
    if (value) return value
  }

  const strong = lastMatch(md, /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/gm)
  if (strong?.[1]) {
    const value = stripMarkdown(strong[1])
    if (value) return value
  }
}

export function ReasoningPartDisplay(props: MessagePartProps) {
  const part = () => props.part as ReasoningPart
  const text = () => part().text.trim()
  const throttledText = createThrottledValue(text)
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const done = () => typeof part().time?.end === "number"
  const duration = () => {
    const t = part().time
    if (!t?.end) return undefined
    return Math.round((t.end - t.start) / 1000)
  }
  const [elapsed, setElapsed] = createSignal(0)
  const elapsedLabel = () => {
    const s = elapsed()
    if (s <= 0) return undefined
    if (s >= 60)
      return i18n.t("ui.message.duration.minutesSeconds", {
        minutes: Math.floor(s / 60),
        seconds: s % 60,
      })
    return i18n.t("ui.message.duration.seconds", { count: s })
  }

  createEffect(() => {
    if (done()) return
    const start = part().time?.start
    if (!start) return
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    onCleanup(() => clearInterval(id))
  })

  const label = () => {
    const s = duration()
    if (s === undefined) return i18n.t("ui.sessionTurn.status.thinking")
    if (s >= 60)
      return i18n.t("ui.reasoning.thoughtFor", {
        duration: i18n.t("ui.message.duration.minutesSeconds", {
          minutes: Math.floor(s / 60),
          seconds: s % 60,
        }),
      })
    return i18n.t("ui.reasoning.thoughtFor", {
      duration: i18n.t("ui.message.duration.seconds", { count: s }),
    })
  }
  const title = createMemo(() => reasoningTitle(throttledText()))

  return (
    <Show when={throttledText()}>
      <div data-component="reasoning-part" data-done={done() || undefined}>
        <Collapsible open={open()} onOpenChange={setOpen} variant="ghost">
          <Collapsible.Trigger>
            <div data-component="reasoning-trigger">
              <Collapsible.Arrow />
              <span data-slot="reasoning-trigger-label">
                <Icon name="sparkles" size="small" />
                <Show when={!done()}>
                  <TextShimmer text={title() || label()} />
                  <Show when={elapsedLabel()}>
                    <span data-slot="reasoning-trigger-elapsed">{elapsedLabel()}</span>
                  </Show>
                </Show>
                <Show when={done()}>{label()}</Show>
              </span>
            </div>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Markdown text={throttledText()} cacheKey={part().id} />
          </Collapsible.Content>
        </Collapsible>
      </div>
    </Show>
  )
}
