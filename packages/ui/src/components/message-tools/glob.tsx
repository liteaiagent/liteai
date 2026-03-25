import { Show } from "solid-js"

import { useI18n } from "../../context/i18n"
import { BasicTool } from "../basic-tool"
import { Markdown } from "../markdown"
import { getDirectory } from "../message-utils"
import { type ToolProps, ToolRegistry } from "../tool-registry"

ToolRegistry.register({
  name: "glob",
  render(props: ToolProps & { input: { path?: string; pattern?: string } }) {
    const i18n = useI18n()
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={{
          title: i18n.t("ui.tool.glob"),
          subtitle: getDirectory(props.input.path || "/"),
          args: props.input.pattern ? [`pattern=${props.input.pattern}`] : [],
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
