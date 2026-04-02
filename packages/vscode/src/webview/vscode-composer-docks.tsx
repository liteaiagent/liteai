import type { LiteaiClient, QuestionAnswer } from "@liteai/sdk/client"
import { SessionPermissionDock, SessionQuestionDock, SessionTodoDock, useLanguage } from "@liteai/ui/panes"
import { useSpring } from "@liteai/ui/motion-spring"
import { showToast } from "@liteai/ui/toast"
import { type Component, createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
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

  const alive = createMemo(() => {
    const id = props.sessionID
    if (!id) return false
    const status = props.store.store.session_status[id]
    return status?.type !== "idle"
  })

  const [todoDock, setTodoDock] = createSignal(false)
  let todoTimer: number | undefined

  createEffect(() => {
    const q = question()
    const p = permission()
    const list = todos()
    const isAlive = alive()

    if (list.length === 0 || q || p) {
      if (todoTimer) window.clearTimeout(todoTimer)
      setTodoDock(false)
      return
    }

    const isDone = list.length > 0 && list.every((t) => t.status === "completed" || t.status === "cancelled")

    if (isDone && !isAlive) {
      if (!todoTimer) {
        todoTimer = window.setTimeout(() => setTodoDock(false), 400)
      }
    } else {
      if (todoTimer) {
        window.clearTimeout(todoTimer)
        todoTimer = undefined
      }
      setTodoDock(true)
    }
  })

  onCleanup(() => {
    if (todoTimer) window.clearTimeout(todoTimer)
  })

  const progress = useSpring(() => (todoDock() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const dockValue = createMemo(() => Math.max(0, Math.min(1, progress())))
  const dockVisible = createMemo(() => todoDock() || dockValue() > 0.001)

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
      <Show when={question()} keyed>
        {(req) => (
          <div class="pointer-events-auto z-20">
            <SessionQuestionDock
              request={req}
              onReply={handleQuestionReply}
              onReject={handleQuestionReject}
              onSubmit={() => {}}
            />
          </div>
        )}
      </Show>
      <Show when={permission()} keyed>
        {(req) => (
          <div class="pointer-events-auto z-20">
            <SessionPermissionDock
              request={req}
              responding={permissionResponding()}
              onDecide={handlePermissionDecide}
            />
          </div>
        )}
      </Show>
      <Show when={dockVisible()}>
        <div
          class="pointer-events-auto z-20 grid overflow-hidden transition-all duration-300"
          style={{
            "grid-template-rows": todoDock() ? "1fr" : "0fr",
            "opacity": dockValue() > 0.98 ? "1" : dockValue(),
          }}
        >
          <div class="min-h-0">
            <SessionTodoDock
              sessionID={props.sessionID}
              todos={todos()}
              collapseLabel={language.t("ui.common.collapse")}
              expandLabel={language.t("ui.common.expand")}
              dockProgress={dockValue()}
            />
          </div>
        </div>
      </Show>
    </div>
  )
}
