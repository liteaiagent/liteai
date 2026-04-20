import type { ToolPart } from "@liteai/sdk"
import { createMemo, Match, Show, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useData } from "../../context"
import { useI18n } from "../../context/i18n"
import { useAgentPanel } from "../agent-panel/agent-panel"
import { GenericTool } from "../basic-tool"
import type { MessagePartProps } from "../message-part"
import { sessionLink } from "../message-utils"
import { ToolErrorCard } from "../tool-error-card"
import { ToolRegistry } from "../tool-registry"

export function ToolPartDisplay(props: MessagePartProps) {
  const data = useData()
  const i18n = useI18n()
  const part = () => props.part as ToolPart
  if (part().tool === "todowrite" || part().tool === "todoread") return null

  const hideQuestion = createMemo(
    () => part().tool === "question" && (part().state.status === "pending" || part().state.status === "running"),
  )

  const emptyInput: Record<string, unknown> = {}

  const input = () => part().state?.input ?? emptyInput
  const partMetadata = createMemo(() => {
    return part().metadata ?? part().state.metadata ?? {}
  })
  const taskId = createMemo(() => {
    if (part().tool !== "task") return
    const value = partMetadata().sessionId
    if (typeof value === "string" && value) return value
  })
  const taskHref = createMemo(() => {
    if (part().tool !== "task") return
    return sessionLink(taskId(), "", data.sessionHref)
  })
  const taskSubtitle = createMemo(() => {
    if (part().tool !== "task") return undefined
    const value = input().description
    if (typeof value === "string" && value) return value
    return taskId()
  })

  const render = createMemo(() => ToolRegistry.render(part().tool) ?? GenericTool)

  const panelCtx = useAgentPanel()

  return (
    <Show when={!hideQuestion()}>
      <div data-component="tool-part-wrapper">
        <Show when={taskId() && panelCtx}>
          <div style={{ "margin-bottom": "8px" }}>
            <button
              type="button"
              onClick={() => {
                const [, setPanel] = panelCtx as NonNullable<typeof panelCtx>
                setPanel("drawerOpen", true)
                setPanel("selectedAgentId", taskId())
              }}
              style={{
                padding: "4px 10px",
                "font-size": "11px",
                "font-weight": "600",
                "border-radius": "12px",
                background: "var(--color-accent-muted, rgba(88, 101, 242, 0.15))",
                color: "var(--color-accent, #5865F2)",
                border: "1px solid var(--color-accent-muted, rgba(88, 101, 242, 0.3))",
                cursor: "pointer",
                display: "inline-flex",
                "align-items": "center",
              }}
              title="Open Agent Panel"
            >
              Explore Agent
            </button>
          </div>
        </Show>
        <Switch>
          <Match when={part().state.status === "error" && (part().state as { error?: string }).error}>
            {(error) => {
              const cleaned = error().replace("Error: ", "")
              if (part().tool === "question" && cleaned.includes("dismissed this question")) {
                return (
                  <div style="width: 100%; display: flex; justify-content: flex-end;">
                    <span class="text-13-regular text-text-weak cursor-default">
                      {i18n.t("ui.messagePart.questions.dismissed")}
                    </span>
                  </div>
                )
              }
              return (
                <ToolErrorCard
                  tool={part().tool}
                  error={error()}
                  defaultOpen={props.defaultOpen}
                  subtitle={taskSubtitle()}
                  href={taskHref()}
                  taskId={taskId()}
                />
              )
            }}
          </Match>
          <Match when={true}>
            <Dynamic
              component={render()}
              input={input()}
              tool={part().tool}
              metadata={partMetadata()}
              // @ts-expect-error
              output={part().state.output}
              status={part().state.status}
              hideDetails={props.hideDetails}
              defaultOpen={props.defaultOpen}
            />
          </Match>
        </Switch>
      </div>
    </Show>
  )
}
