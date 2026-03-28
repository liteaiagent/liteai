import { showToast, toaster } from "@liteai/ui/toast"
import { base64Encode } from "@liteai/util/encode"
import type { Project, Session } from "@liteai-ai/sdk/client"
import type { Accessor } from "solid-js"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { useLanguage } from "@/context/language"
import type { LocalProject, useLayout } from "@/context/layout"
import type { usePlatform } from "@/context/platform"
import { clearWorkspaceTerminals } from "@/context/terminal"
import { toProjectID } from "@/utils/project-id"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { effectiveWorkspaceOrder, errorMessage, workspaceKey } from "./helpers"

export type WorkspaceOpsDeps = {
  globalSDK: ReturnType<typeof useGlobalSDK>
  globalSync: ReturnType<typeof useGlobalSync>
  language: ReturnType<typeof useLanguage>
  layout: ReturnType<typeof useLayout>
  platform: ReturnType<typeof usePlatform>
  params: { dir?: string; id?: string }
  navigate: (href: string) => void
  currentDir: Accessor<string>
  navigateWithSidebarReset: (href: string) => void
  clearSidebarHoverState: () => void
  setBusy: (directory: string, value: boolean) => void
  store: {
    workspaceOrder: Record<string, string[]>
    lastProjectSession: Record<string, { directory: string; id: string; at: number }>
    workspaceExpanded: Record<string, boolean>
  }
  setStore: (...args: unknown[]) => void
  setWorkspaceName: (directory: string, next: string, projectId?: string, branch?: string) => void
  clearLastProjectSession: (root: string) => void
}

export async function deleteWorkspace(deps: WorkspaceOpsDeps, root: string, directory: string, leave = false) {
  if (directory === root) return

  const current = deps.currentDir()
  const currentKey = workspaceKey(current)
  const deletedKey = workspaceKey(directory)
  const shouldLeave = leave || (!!deps.params.dir && currentKey === deletedKey)
  if (!leave && shouldLeave) {
    deps.navigateWithSidebarReset(`/${base64Encode(root)}/session`)
  }

  deps.setBusy(directory, true)

  const result = await deps.globalSDK.client.project.worktree
    .remove({ projectID: toProjectID(root), worktreeRemoveInput: { directory } })
    .then((x) => x.data)
    .catch((err) => {
      showToast({
        title: deps.language.t("workspace.delete.failed.title"),
        description: errorMessage(err, deps.language.t("common.requestFailed")),
      })
      return false
    })

  deps.setBusy(directory, false)

  if (!result) return

  if (workspaceKey(deps.store.lastProjectSession[root]?.directory ?? "") === workspaceKey(directory)) {
    deps.clearLastProjectSession(root)
  }

  deps.globalSync.set("project", ((draft: Project[]) => {
    const project = draft.find((item) => item.worktree === root)
    if (!project) return
    project.sandboxes = (project.sandboxes ?? []).filter((sandbox: string) => sandbox !== directory)
  }) as never)
  ;(deps.setStore as (...a: unknown[]) => void)("workspaceOrder", root, (order: string[]) =>
    (order ?? []).filter((workspace: string) => workspace !== directory),
  )

  deps.layout.projects.close(directory)
  deps.layout.projects.open(root)

  if (shouldLeave) return

  const nextCurrent = deps.currentDir()
  const nextKey = workspaceKey(nextCurrent)
  const project = deps.layout.projects.list().find((item) => item.worktree === root)
  const dirs = project
    ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], deps.store.workspaceOrder[root])
    : [root]
  const valid = dirs.some((item) => workspaceKey(item) === nextKey)

  const projectRoot = (d: string) => {
    const p = deps.layout.projects.list().find((item) => item.worktree === d || item.sandboxes?.includes(d))
    return p?.worktree ?? d
  }

  if (deps.params.dir && projectRoot(nextCurrent) === root && !valid) {
    deps.navigateWithSidebarReset(`/${base64Encode(root)}/session`)
  }
}

export async function resetWorkspace(deps: WorkspaceOpsDeps, root: string, directory: string) {
  if (directory === root) return
  deps.setBusy(directory, true)

  const progress = showToast({
    persistent: true,
    title: deps.language.t("workspace.resetting.title"),
    description: deps.language.t("workspace.resetting.description"),
  })
  const dismiss = () => toaster.dismiss(progress)

  const sessions: Session[] = await deps.globalSDK.client.project.session
    .list({ projectID: toProjectID(directory) })
    .then((x) => x.data ?? [])
    .catch(() => [])

  clearWorkspaceTerminals(
    directory,
    sessions.map((s) => s.id),
    deps.platform,
  )
  await deps.globalSDK.client.project.instance.dispose({ projectID: toProjectID(directory) }).catch(() => undefined)

  const result = await deps.globalSDK.client.project.worktree
    .reset({ projectID: toProjectID(root), worktreeResetInput: { directory } })
    .then((x) => x.data)
    .catch((err) => {
      showToast({
        title: deps.language.t("workspace.reset.failed.title"),
        description: errorMessage(err, deps.language.t("common.requestFailed")),
      })
      return false
    })

  if (!result) {
    deps.setBusy(directory, false)
    dismiss()
    return
  }

  const archivedAt = Date.now()
  await Promise.all(
    sessions
      .filter((session) => session.time.archived === undefined)
      .map((session) =>
        deps.globalSDK.client.project.session
          .update({
            sessionID: session.id,
            projectID: toProjectID(session.directory),
            time: { archived: archivedAt },
          })
          .catch(() => undefined),
      ),
  )

  deps.setBusy(directory, false)
  dismiss()

  showToast({
    title: deps.language.t("workspace.reset.success.title"),
    description: deps.language.t("workspace.reset.success.description"),
    actions: [
      {
        label: deps.language.t("command.session.new"),
        onClick: () => {
          const href = `/${base64Encode(directory)}/session`
          deps.navigate(href)
          deps.layout.mobileSidebar.hide()
        },
      },
      {
        label: deps.language.t("common.dismiss"),
        onClick: "dismiss",
      },
    ],
  })
}

export async function createWorkspace(deps: WorkspaceOpsDeps, project: LocalProject) {
  deps.clearSidebarHoverState()
  const created = await deps.globalSDK.client.project.worktree
    .create({ projectID: toProjectID(project.worktree) })
    .then((x) => x.data)
    .catch((err) => {
      showToast({
        title: deps.language.t("workspace.create.failed.title"),
        description: errorMessage(err, deps.language.t("common.requestFailed")),
      })
      return undefined
    })

  if (!created?.directory) return

  deps.setWorkspaceName(created.directory, created.branch, project.id, created.branch)

  const local = project.worktree
  const key = workspaceKey(created.directory)
  const root = workspaceKey(local)

  deps.setBusy(created.directory, true)
  WorktreeState.pending(created.directory)
  ;(deps.setStore as (...a: unknown[]) => void)("workspaceExpanded", key, true)
  if (key !== created.directory) {
    ;(deps.setStore as (...a: unknown[]) => void)("workspaceExpanded", created.directory, true)
  }
  ;(deps.setStore as (...a: unknown[]) => void)("workspaceOrder", project.worktree, (prev: string[]) => {
    const existing = prev ?? []
    const next = existing.filter((item: string) => {
      const id = workspaceKey(item)
      return id !== root && id !== key
    })
    return [created.directory, ...next]
  })

  deps.globalSync.child(created.directory)
  deps.navigateWithSidebarReset(`/${base64Encode(created.directory)}/session`)
}
