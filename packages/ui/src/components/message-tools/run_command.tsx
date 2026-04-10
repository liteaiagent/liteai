import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import stripAnsi from "strip-ansi"

import { useI18n } from "../../context/i18n"
import { BasicTool } from "../basic-tool"
import { IconButton } from "../icon-button"
import { TextShimmer } from "../text-shimmer"
import { type ToolProps, ToolRegistry } from "../tool-registry"
import { Tooltip } from "../tooltip"
import { ShellSubmessage } from "./shared"

ToolRegistry.register({
  name: "run_command",
  render(
    props: ToolProps & {
      input: { command?: string; description?: string }
      metadata: {
        command?: string
        output?: string
        elapsed?: number
        startTime?: number
        commandId?: string
        status?: string
      }
    },
  ) {
    const i18n = useI18n()
    const pending = () => props.status === "pending" || props.status === "running"
    const sawPending = pending()

    const [elapsed, setElapsed] = createSignal(0)
    createEffect(() => {
      if (props.metadata.elapsed !== undefined) {
        setElapsed(props.metadata.elapsed)
        return
      }
      const start = props.metadata.startTime
      if (!start || !pending()) return

      const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
      tick()
      const id = setInterval(tick, 1000)
      onCleanup(() => clearInterval(id))
    })

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

    const text = createMemo(() => {
      const cmd = props.input.command ?? props.metadata.command ?? ""
      const out = stripAnsi(props.output || props.metadata.output || "")
      return `$ ${cmd}${out ? `\n\n${out}` : ""}`
    })
    const [copied, setCopied] = createSignal(false)

    const handleCopy = async () => {
      const content = text()
      if (!content) return
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }

    return (
      <BasicTool
        {...props}
        icon="console"
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title" style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <TextShimmer text={i18n.t("ui.tool.shell")} active={pending()} />
                <Show when={pending() && elapsedLabel()}>
                  <span style={{ color: "var(--text-neutral-light)", "white-space": "nowrap" }}>
                    ({elapsedLabel()})
                  </span>
                </Show>
              </span>
              <Show when={props.metadata.commandId && props.metadata.status === "running"}>
                <ShellSubmessage
                  text={i18n.t("ui.message.backgroundedWaiting", { commandId: props.metadata.commandId as string })}
                  animate={sawPending}
                />
              </Show>
              <Show
                when={
                  !pending() &&
                  props.input.description &&
                  !(props.metadata.commandId && props.metadata.status === "running")
                }
              >
                <ShellSubmessage text={props.input.description || ""} animate={sawPending} />
              </Show>
            </div>
          </div>
        }
      >
        <div data-component="run_command-output">
          <div data-slot="run_command-copy">
            <Tooltip
              value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              placement="top"
              gutter={4}
            >
              <IconButton
                icon={copied() ? "check" : "copy"}
                size="small"
                variant="secondary"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCopy}
                aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              />
            </Tooltip>
          </div>
          <div data-slot="run_command-scroll" data-scrollable>
            <pre data-slot="run_command-pre">
              <code>{text()}</code>
            </pre>
          </div>
        </div>
      </BasicTool>
    )
  },
})
