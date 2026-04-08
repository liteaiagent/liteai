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
  name: "send_command_input",
  render(
    props: ToolProps & {
      input: { CommandId?: string; Input?: string; Terminate?: boolean }
      metadata: {
        commandId?: string
        output?: string
      }
    },
  ) {
    const i18n = useI18n()
    const pending = () => props.status === "pending" || props.status === "running"
    const sawPending = pending()

    // What was sent
    const commandText = createMemo(() => {
      if (props.input.Terminate) return "Terminate signal sent"
      if (props.input.Input) return `Sent input: ${JSON.stringify(props.input.Input)}`
      return "Sending input to command..."
    })

    const text = createMemo(() => {
      let out = props.output || props.metadata.output || ""
      if (typeof out === "object") out = JSON.stringify(out, null, 2)
      return stripAnsi(out)
    })

    const [copied, setCopied] = createSignal(false)

    const handleCopy = async () => {
      const content = text()
      if (!content) return
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }

    const commandId = () => props.metadata.commandId || props.input.CommandId

    return (
      <BasicTool
        {...props}
        icon="console"
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={commandText()} active={pending()} />
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
