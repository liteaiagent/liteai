import { createMemo, createSignal, Show } from "solid-js"
import stripAnsi from "strip-ansi"

import { useI18n } from "../../context/i18n"
import { BasicTool } from "../basic-tool"
import { IconButton } from "../icon-button"
import { TextShimmer } from "../text-shimmer"
import { type ToolProps, ToolRegistry } from "../tool-registry"
import { Tooltip } from "../tooltip"
import { ShellSubmessage } from "./shared"

ToolRegistry.register({
  name: "command_status",
  render(
    props: ToolProps & {
      input: { CommandId?: string }
      metadata: {
        status?: string
        commandId?: string
        output?: string
        elapsed?: number
      }
    },
  ) {
    const i18n = useI18n()
    const pending = () => props.status === "pending" || props.status === "running"
    const sawPending = pending()

    const text = createMemo(() => {
      let out = props.output || props.metadata.output || ""
      if (typeof out === "object") out = JSON.stringify(out, null, 2)
      return stripAnsi(out)
    })

    const titleText = createMemo(() => {
      if (pending()) return "Checking command status..."
      const stat = props.metadata.status
      if (stat === "running") return "Command running"
      if (stat === "done") return "Command finished"
      if (stat === "error") return "Command error"
      return "Command status"
    })

    const commandId = () => props.metadata.commandId || props.input.CommandId

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
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={titleText()} active={pending()} />
              </span>
              <Show when={commandId()}>
                <ShellSubmessage text={`Command ID: ${commandId()}`} animate={sawPending} />
              </Show>
            </div>
          </div>
        }
      >
        <Show when={text()}>
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
        </Show>
      </BasicTool>
    )
  },
})
