import { Button } from "@liteai/ui/button"
import { useDialog } from "@liteai/ui/context/dialog"
import { Dialog } from "@liteai/ui/dialog"
import { getFilename } from "@liteai/util/path"
import type { Session } from "@liteai-ai/sdk/client"
import { useParams } from "@solidjs/router"
import { createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useLanguage } from "@/context/language"
import { toProjectID } from "@/utils/project-id"
import { workspaceKey } from "./helpers"

export type WorkspaceDialogDeps = {
  globalSDK: ReturnType<typeof useGlobalSDK>
  language: ReturnType<typeof useLanguage>
  currentDir: () => string
  navigateWithSidebarReset: (href: string) => void
  deleteWorkspace: (root: string, directory: string, leaveDeletedWorkspace?: boolean) => Promise<void>
  resetWorkspace: (root: string, directory: string) => Promise<void>
}

export function DialogDeleteWorkspace(props: { root: string; directory: string; deps: WorkspaceDialogDeps }) {
  const dialog = useDialog()
  const params = useParams()
  const name = createMemo(() => getFilename(props.directory))
  const [data, setData] = createStore({
    status: "loading" as "loading" | "ready" | "error",
    dirty: false,
  })

  onMount(() => {
    props.deps.globalSDK.client.project.file
      .status({ projectID: toProjectID(props.directory) })
      .then((x) => {
        const files = x.data ?? []
        const dirty = files.length > 0
        setData({ status: "ready", dirty })
      })
      .catch(() => {
        setData({ status: "error", dirty: false })
      })
  })

  const handleDelete = () => {
    const leave = !!params.projectID && workspaceKey(props.deps.currentDir()) === workspaceKey(props.directory)
    if (leave) {
      props.deps.navigateWithSidebarReset(`/${toProjectID(props.root)}/session`)
    }
    dialog.close()
    void props.deps.deleteWorkspace(props.root, props.directory, leave)
  }

  const description = () => {
    if (data.status === "loading") return props.deps.language.t("workspace.status.checking")
    if (data.status === "error") return props.deps.language.t("workspace.status.error")
    if (!data.dirty) return props.deps.language.t("workspace.status.clean")
    return props.deps.language.t("workspace.status.dirty")
  }

  return (
    <Dialog title={props.deps.language.t("workspace.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {props.deps.language.t("workspace.delete.confirm", { name: name() })}
          </span>
          <span class="text-12-regular text-text-weak">{description()}</span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {props.deps.language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={data.status === "loading"} onClick={handleDelete}>
            {props.deps.language.t("workspace.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function DialogResetWorkspace(props: { root: string; directory: string; deps: WorkspaceDialogDeps }) {
  const dialog = useDialog()
  const name = createMemo(() => getFilename(props.directory))
  const [state, setState] = createStore({
    status: "loading" as "loading" | "ready" | "error",
    dirty: false,
    sessions: [] as Session[],
  })

  const refresh = async () => {
    const sessions = await props.deps.globalSDK.client.project.session
      .list({ projectID: toProjectID(props.directory) })
      .then((x) => x.data ?? [])
      .catch(() => [])
    const active = sessions.filter((session) => session.time.archived === undefined)
    setState({ sessions: active })
  }

  onMount(() => {
    props.deps.globalSDK.client.project.file
      .status({ projectID: toProjectID(props.directory) })
      .then((x) => {
        const files = x.data ?? []
        const dirty = files.length > 0
        setState({ status: "ready", dirty })
        void refresh()
      })
      .catch(() => {
        setState({ status: "error", dirty: false })
      })
  })

  const handleReset = () => {
    dialog.close()
    void props.deps.resetWorkspace(props.root, props.directory)
  }

  const count = () => state.sessions.length

  const description = () => {
    if (state.status === "loading") return props.deps.language.t("workspace.status.checking")
    if (state.status === "error") return props.deps.language.t("workspace.status.error")
    if (!state.dirty) return props.deps.language.t("workspace.status.clean")
    return props.deps.language.t("workspace.status.dirty")
  }

  const archived = () => {
    const c = count()
    if (c === 0) return props.deps.language.t("workspace.reset.archived.none")
    if (c === 1) return props.deps.language.t("workspace.reset.archived.one")
    return props.deps.language.t("workspace.reset.archived.many", { count: c })
  }

  return (
    <Dialog title={props.deps.language.t("workspace.reset.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {props.deps.language.t("workspace.reset.confirm", { name: name() })}
          </span>
          <span class="text-12-regular text-text-weak">
            {description()} {archived()} {props.deps.language.t("workspace.reset.note")}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {props.deps.language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={state.status === "loading"} onClick={handleReset}>
            {props.deps.language.t("workspace.reset.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
