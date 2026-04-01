import { createMemo, Show } from "solid-js"

import { useData } from "../../context"
import { useI18n } from "../../context/i18n"
import { BasicTool } from "../basic-tool"
import { agentTitle, sessionLink } from "../message-utils"
import { TextShimmer } from "../text-shimmer"
import { ToolRegistry } from "../tool-registry"

ToolRegistry.register({
  name: "task",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const childSessionId = () => props.metadata.sessionId as string | undefined
    const type = createMemo(() => {
      const raw = props.input.subagent_type
      if (typeof raw !== "string" || !raw) return undefined
      return raw.charAt(0).toUpperCase() + raw.slice(1)
    })
    const title = createMemo(() => agentTitle(i18n, type()))
    const subtitle = createMemo(() => {
      const value = props.input.description
      if (typeof value === "string" && value) return value
      return childSessionId()
    })
    const running = createMemo(() => props.status === "pending" || props.status === "running")

    const href = createMemo(() => sessionLink(childSessionId(), "", data.sessionHref))

    const titleContent = () => <TextShimmer text={title()} active={running()} />

    const trigger = () => (
      <div data-slot="basic-tool-tool-info-structured">
        <div data-slot="basic-tool-tool-info-main">
          <span data-slot="basic-tool-tool-title" class="capitalize agent-title">
            {titleContent()}
          </span>
          <Show when={subtitle()}>
            <button
              type="button"
              data-slot="basic-tool-tool-subtitle"
              classList={{ clickable: !!href(), "subagent-link": !!href() }}
              onClick={(e) => {
                const url = href()
                if (!url) return
                e.stopPropagation()
                e.preventDefault()
                const id = childSessionId()
                if (id && data.navigateToSession) {
                  data.navigateToSession(id)
                } else {
                  window.location.assign(url)
                }
              }}
            >
              {subtitle()}
            </button>
          </Show>
        </div>
      </div>
    )

    return <BasicTool icon="task" status={props.status} trigger={trigger()} hideDetails />
  },
})
