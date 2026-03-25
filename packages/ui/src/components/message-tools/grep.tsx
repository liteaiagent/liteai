import { Show } from "solid-js"

import { useI18n } from "../../context/i18n"
import { BasicTool } from "../basic-tool"
import { Markdown } from "../markdown"
import { getDirectory } from "../message-utils"
import { type ToolProps, ToolRegistry } from "../tool-registry"

ToolRegistry.register({
  name: "grep",
  render(
    props: ToolProps & {
      input: { path?: string; pattern?: string; include?: string }
    },
  ) {
    const i18n = useI18n()
    const args: string[] = []
    if (props.input.pattern) args.push(`pattern=${props.input.pattern}`)
    if (props.input.include) args.push(`include=${props.input.include}`)
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={{
          title: i18n.t("ui.tool.grep"),
          subtitle: getDirectory(props.input.path || "/"),
          args,
        }}
      >
        <Show when={props.output}>
          <div data-component="tool-output" data-scrollable>
            <Markdown text={props.output ?? ""} />
          </div>
        </Show>
      </BasicTool>
    )
  },
})
