import type { LiteaiClient, QuestionAnswer } from "@liteai/sdk/client"
import { SessionPermissionDock, SessionQuestionDock, SessionTodoDock, useLanguage } from "@liteai/ui/panes"
import { showToast } from "@liteai/ui/toast"
import { type Component, createMemo, createSignal, Show } from "solid-js"
import type { VscodeStore } from "./vscode-store"

export const VscodeComposerDocks: Component<{
  store: VscodeStore
  client: LiteaiClient
  projectID: string
  sessionID: string | undefined
}> = (props) => {
  const language = useLanguage()
  const [permissionResponding, setPermissionResponding] = createSignal(false)

  const todos = createMemo(() => {
    const id = props.sessionID
    if (!id) return []
    return props.store.store.todo[id] ?? []
  })

  const question = createMemo(() => {
    const id = props.sessionID
    if (!id) return undefined
    const status = props.store.store.session_status[id]
    if (status?.type === "idle") return undefined
    const list = props.store.store.question[id] ?? []
    return list.find((_q) => true)
  })

  const permission = createMemo(() => {
    const id = props.sessionID
    if (!id) return undefined
    const status = props.store.store.session_status[id]
    if (status?.type === "idle") return undefined
    const list = props.store.store.permission[id] ?? []
    return list.find((_p) => true)
  })

  const handlePermissionDecide = async (response: "once" | "always" | "reject") => {
    const req = permission()
    if (!req) return
    setPermissionResponding(true)
    try {
      await props.client.project.permission.reply({
        projectID: props.projectID,
        requestID: req.id,
        reply: response,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setPermissionResponding(false)
    }
  }

  const handleQuestionReply = async (answers: QuestionAnswer[]) => {
    const req = question()
    if (!req) return
    await props.client.project.question.reply({
      projectID: props.projectID,
      requestID: req.id,
      answers,
    })
  }

  const handleQuestionReject = async () => {
    const req = question()
    if (!req) return
    await props.client.project.question.reject({
      projectID: props.projectID,
      requestID: req.id,
    })
  }

  return (
    <div class="flex flex-col gap-3 relative mb-3 empty:mb-0 pointer-events-none empty:hidden">
      <Show when={permission()} keyed>
        {(req) => (
          <div class="pointer-events-auto">
            <SessionPermissionDock
              request={req}
              responding={permissionResponding()}
              onDecide={handlePermissionDecide}
            />
          </div>
        )}
      </Show>
      <Show when={question()} keyed>
        {(req) => (
          <div class="pointer-events-auto z-10 transition-transform origin-bottom duration-300">
            <SessionQuestionDock
              request={req}
              onReply={handleQuestionReply}
              onReject={handleQuestionReject}
              onSubmit={() => {}}
            />
          </div>
        )}
      </Show>
      <Show when={todos().length > 0}>
        <div class="pointer-events-auto z-20">
          <SessionTodoDock
            sessionID={props.sessionID}
            todos={todos()}
            collapseLabel={language.t("ui.common.collapse")}
            expandLabel={language.t("ui.common.expand")}
            dockProgress={1}
          />
        </div>
      </Show>
    </div>
  )
}
