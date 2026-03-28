import { Binary } from "@liteai/util/binary"
import { getFilename } from "@liteai/util/path"
import type { Project, Session } from "@liteai/sdk/client"
import { type Accessor, untrack } from "solid-js"
import { produce } from "solid-js/store"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { LocalProject, useLayout } from "@/context/layout"
import type { useNotification } from "@/context/notification"
import type { useServer } from "@/context/server"
import { setSessionHandoff } from "@/pages/session/handoff"
import { toProjectID } from "@/utils/project-id"
import { collectNewSessionDeepLinks, collectOpenProjectDeepLinks } from "./deep-links"
import { effectiveWorkspaceOrder, latestRootSession, workspaceKey } from "./helpers"

export type NavigationDeps = {
  globalSDK: ReturnType<typeof useGlobalSDK>
  globalSync: ReturnType<typeof useGlobalSync>
  layout: ReturnType<typeof useLayout>
  notification: ReturnType<typeof useNotification>
  server: ReturnType<typeof useServer>
  params: { projectID?: string; id?: string }
  navigate: (href: string) => void
  currentDir: Accessor<string>
  navigateWithSidebarReset: (href: string) => void
  currentProject: Accessor<LocalProject | undefined>
  store: {
    lastProjectSession: Record<string, { directory: string; id: string; at: number }>
    workspaceOrder: Record<string, string[]>
    workspaceExpanded: Record<string, boolean>
  }
  setStore: (...args: unknown[]) => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  warm: (sessions: Session[], index: number) => void
  currentSessions: Accessor<Session[]>
}

export function projectRoot(deps: NavigationDeps, directory: string) {
  const project = deps.layout.projects
    .list()
    .find((item) => item.worktree === directory || item.sandboxes?.includes(directory))
  if (project) return project.worktree

  const known = Object.entries(deps.store.workspaceOrder).find(
    ([root, dirs]) => root === directory || dirs.includes(directory),
  )
  if (known) return known[0]

  const [child] = deps.globalSync.child(directory, { bootstrap: false })
  const id = child.project
  if (!id) return directory

  const meta = deps.globalSync.data.project.find((item) => item.id === id)
  return meta?.worktree ?? directory
}

export function activeProjectRoot(deps: NavigationDeps, directory: string) {
  return deps.currentProject()?.worktree ?? projectRoot(deps, directory)
}

export function touchProjectRoute(deps: NavigationDeps) {
  const root = deps.currentProject()?.worktree
  if (!root) return
  if (deps.layout.projects.last() !== root) deps.layout.projects.touch(root)
  return root
}

export function rememberSessionRoute(
  deps: NavigationDeps,
  directory: string,
  id: string,
  root = activeProjectRoot(deps, directory),
) {
  ;(deps.setStore as (...a: unknown[]) => void)("lastProjectSession", root, { directory, id, at: Date.now() })
  return root
}

export function clearLastProjectSession(deps: NavigationDeps, root: string) {
  if (!deps.store.lastProjectSession[root]) return
  ;(deps.setStore as (...a: unknown[]) => void)(
    "lastProjectSession",
    produce((draft: Record<string, unknown>) => {
      delete draft[root]
    }),
  )
}

export function syncSessionRoute(
  deps: NavigationDeps,
  directory: string,
  id: string,
  root = activeProjectRoot(deps, directory),
) {
  rememberSessionRoute(deps, directory, id, root)
  deps.notification.session.markViewed(id)
  const expanded = untrack(() => deps.store.workspaceExpanded[directory])
  if (expanded === false) {
    ;(deps.setStore as (...a: unknown[]) => void)("workspaceExpanded", directory, true)
  }
  return root
}

export async function navigateToProject(deps: NavigationDeps, directory: string | undefined) {
  if (!directory) return
  const root = projectRoot(deps, directory)
  deps.layout.projects.touch(root)
  const project = deps.layout.projects.list().find((item) => item.worktree === root)
  let dirs = project
    ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], deps.store.workspaceOrder[root])
    : [root]
  const canOpen = (value: string | undefined) => {
    if (!value) return false
    return dirs.some((item) => workspaceKey(item) === workspaceKey(value))
  }
  const refreshDirs = async (target?: string) => {
    if (!target || target === root || canOpen(target)) return canOpen(target)
    const listed = await deps.globalSDK.client.project.worktree
      .list({ projectID: toProjectID(root) })
      .then((x) => x.data ?? [])
      .catch(() => [] as string[])
    dirs = effectiveWorkspaceOrder(root, [root, ...listed], deps.store.workspaceOrder[root])
    return canOpen(target)
  }
  const openSession = async (target: { directory: string; id: string }) => {
    if (!canOpen(target.directory)) return false
    const [data] = deps.globalSync.child(target.directory, { bootstrap: false })
    if (data.session.some((item) => item.id === target.id)) {
      ;(deps.setStore as (...a: unknown[]) => void)("lastProjectSession", root, {
        directory: target.directory,
        id: target.id,
        at: Date.now(),
      })
      deps.navigateWithSidebarReset(`/${toProjectID(target.directory)}/session/${target.id}`)
      return true
    }
    const resolved = await deps.globalSDK.client.project.session
      .get({ projectID: toProjectID(target.directory), sessionID: target.id })
      .then((x) => x.data)
      .catch(() => undefined)
    if (!resolved?.directory) return false
    if (!canOpen(resolved.directory)) return false
    ;(deps.setStore as (...a: unknown[]) => void)("lastProjectSession", root, {
      directory: resolved.directory,
      id: resolved.id,
      at: Date.now(),
    })
    deps.navigateWithSidebarReset(`/${toProjectID(resolved.directory)}/session/${resolved.id}`)
    return true
  }

  const projectSession = deps.store.lastProjectSession[root]
  if (projectSession?.id) {
    await refreshDirs(projectSession.directory)
    const opened = await openSession(projectSession)
    if (opened) return
    clearLastProjectSession(deps, root)
  }

  const latest = latestRootSession(
    dirs.map((item) => deps.globalSync.child(item, { bootstrap: false })[0]),
    Date.now(),
  )
  if (latest && (await openSession(latest))) {
    return
  }

  const fetched = latestRootSession(
    await Promise.all(
      dirs.map(async (item) => ({
        path: { directory: item },
        session: await deps.globalSDK.client.project.session
          .list({ projectID: toProjectID(item) })
          .then((x) => x.data ?? [])
          .catch(() => []),
      })),
    ),
    Date.now(),
  )
  if (fetched && (await openSession(fetched))) {
    return
  }

  deps.navigateWithSidebarReset(`/${toProjectID(root)}/session`)
}

export function navigateToSession(deps: NavigationDeps, session: Session | undefined) {
  if (!session) return
  deps.navigateWithSidebarReset(`/${toProjectID(session.directory)}/session/${session.id}`)
}

export async function openProject(deps: NavigationDeps, directory: string, nav = true) {
  try {
    await deps.globalSDK.client.project.create({ directory })
  } catch {
    // ignore explicit creation failures
  }
  deps.layout.projects.open(directory)
  if (nav) await navigateToProject(deps, directory)
}

export function closeProject(deps: NavigationDeps, directory: string) {
  const list = deps.layout.projects.list()
  const key = workspaceKey(directory)
  const index = list.findIndex((x) => workspaceKey(x.worktree) === key)
  const active = workspaceKey(deps.currentProject()?.worktree ?? "") === key
  const project = list[index]
  console.debug("[project] close", {
    directory,
    key,
    index,
    active,
    count: list.length,
    id: project?.id,
  })
  if (index === -1) {
    console.warn("[project] close: project not found in list — nothing to close", { directory, key })
    return
  }

  // Optimistically mark as archived in globalSync so the DB sync won't re-add
  deps.globalSync.set("project", ((draft: Project[]) => {
    const match = draft.find((p) => workspaceKey(p.worktree) === key)
    if (!match) return
    if (!match.time) match.time = {} as typeof match.time
    match.time.archived = Date.now()
  }) as never)

  // Archive in DB (fire-and-forget — SSE event will confirm)
  if (project?.id && project.id !== "global") {
    void deps.globalSDK.client.project.archive({ projectID: project.id })
  }

  if (!active) {
    if (deps.layout.projects.last() === directory) deps.layout.projects.touch(undefined)
    deps.layout.projects.close(directory)
    return
  }

  const target = list[index + 1] ?? list[index - 1]
  console.debug("[project] close active → navigate to", target?.worktree ?? "home")

  if (!target) {
    deps.layout.projects.touch(undefined)
    deps.layout.projects.close(directory)
    deps.navigate("/")
    return
  }

  deps.navigateWithSidebarReset(`/${toProjectID(target.worktree)}/session`)
  deps.layout.projects.close(directory)
  queueMicrotask(() => {
    void navigateToProject(deps, target.worktree)
  })
}

export async function renameProject(deps: NavigationDeps, project: LocalProject, next: string) {
  const current = project.name || getFilename(project.worktree)
  if (next === current) return
  const name = next === getFilename(project.worktree) ? "" : next

  if (project.id && project.id !== "global") {
    await deps.globalSDK.client.project.update({ projectID: project.id, name })
    return
  }

  deps.globalSync.project.meta(project.worktree, { name })
}

export function archiveSession(deps: NavigationDeps, session: Session) {
  const [store, setStore] = deps.globalSync.child(session.directory)
  const sessions = store.session ?? []
  const index = sessions.findIndex((s) => s.id === session.id)
  const next = sessions[index + 1] ?? sessions[index - 1]

  return deps.globalSDK.client.project.session
    .update({
      projectID: toProjectID(session.directory),
      sessionID: session.id,
      time: { archived: Date.now() },
    })
    .then(() => {
      setStore(
        produce((draft) => {
          const match = Binary.search(draft.session, session.id, (s) => s.id)
          if (match.found) draft.session.splice(match.index, 1)
        }),
      )
      if (session.id === deps.params.id) {
        if (next) {
          deps.navigate(`/${deps.params.projectID}/session/${next.id}`)
        } else {
          deps.navigate(`/${deps.params.projectID}/session`)
        }
      }
    })
}

export function restoreSession(deps: NavigationDeps, session: Session) {
  return deps.globalSDK.client.project.session
    .update({
      projectID: toProjectID(session.directory),
      sessionID: session.id,
      time: { archived: undefined },
    })
    .then(() => {
      // session.updated SSE will re-add it to the store
    })
}

export async function archiveProject(deps: NavigationDeps, directory: string) {
  closeProject(deps, directory)
}

export async function restoreProject(deps: NavigationDeps, directory: string) {
  const project = deps.globalSync.data.project.find((p) => p.worktree === directory)
  console.debug("[project] restore", { directory, id: project?.id })
  if (!project?.id || project.id === "global") return
  await deps.globalSDK.client.project.unarchive({ projectID: project.id })
  await openProject(deps, directory)
}

export function deleteSession(deps: NavigationDeps, session: Session) {
  const [store, setStore] = deps.globalSync.child(session.directory)
  const sessions = store.session ?? []
  const index = sessions.findIndex((s) => s.id === session.id)
  const next = sessions[index + 1] ?? sessions[index - 1]

  return deps.globalSDK.client.project.session
    .delete({
      projectID: toProjectID(session.directory),
      sessionID: session.id,
    })
    .then(() => {
      setStore(
        produce((draft) => {
          const removed = new Set<string>([session.id])
          const byParent = new Map<string, string[]>()
          for (const item of draft.session) {
            if (!item.parentID) continue
            const existing = byParent.get(item.parentID)
            if (existing) {
              existing.push(item.id)
              continue
            }
            byParent.set(item.parentID, [item.id])
          }
          const stack = [session.id]
          while (stack.length) {
            const id = stack.pop()
            if (!id) continue
            const children = byParent.get(id)
            if (!children) continue
            for (const child of children) {
              if (removed.has(child)) continue
              removed.add(child)
              stack.push(child)
            }
          }
          draft.session = draft.session.filter((s) => !removed.has(s.id))
        }),
      )
      if (session.id === deps.params.id) {
        if (next) {
          deps.navigate(`/${deps.params.projectID}/session/${next.id}`)
        } else {
          deps.navigate(`/${deps.params.projectID}/session`)
        }
      }
    })
}

export function renameSession(deps: NavigationDeps, session: Session, title: string) {
  const [, setStore] = deps.globalSync.child(session.directory)
  return deps.globalSDK.client.project.session
    .update({
      projectID: toProjectID(session.directory),
      sessionID: session.id,
      title,
    })
    .then(() => {
      setStore(
        produce((draft) => {
          const match = Binary.search(draft.session, session.id, (s) => s.id)
          if (match.found) draft.session[match.index].title = title
        }),
      )
    })
}

export function navigateSessionByOffset(deps: NavigationDeps, offset: number) {
  const sessions = deps.currentSessions()
  if (sessions.length === 0) return

  const index = deps.params.id ? sessions.findIndex((s) => s.id === deps.params.id) : -1

  let target: number
  if (index === -1) {
    target = offset > 0 ? 0 : sessions.length - 1
  } else {
    target = (index + offset + sessions.length) % sessions.length
  }

  const session = sessions[target]
  if (!session) return

  deps.prefetchSession(session, "high")
  deps.warm(sessions, target)

  navigateToSession(deps, session)
}

export function navigateSessionByUnseen(deps: NavigationDeps, offset: number) {
  const sessions = deps.currentSessions()
  if (sessions.length === 0) return

  const hasUnseen = sessions.some((session) => deps.notification.session.unseenCount(session.id) > 0)
  if (!hasUnseen) return

  const active = deps.params.id ? sessions.findIndex((s) => s.id === deps.params.id) : -1
  const start = active === -1 ? (offset > 0 ? -1 : 0) : active

  for (let i = 1; i <= sessions.length; i++) {
    const index = offset > 0 ? (start + i) % sessions.length : (start - i + sessions.length) % sessions.length
    const session = sessions[index]
    if (!session) continue
    if (deps.notification.session.unseenCount(session.id) === 0) continue

    deps.prefetchSession(session, "high")
    deps.warm(sessions, index)

    navigateToSession(deps, session)
    return
  }
}

export async function handleDeepLinks(deps: NavigationDeps, urls: string[]) {
  if (!deps.server.isLocal()) return

  for (const directory of collectOpenProjectDeepLinks(urls)) {
    await openProject(deps, directory)
  }

  for (const link of collectNewSessionDeepLinks(urls)) {
    await openProject(deps, link.directory, false)
    const slug = toProjectID(link.directory)
    if (link.prompt) {
      setSessionHandoff(slug, { prompt: link.prompt })
    }
    const href = link.prompt ? `/${slug}/session?prompt=${encodeURIComponent(link.prompt)}` : `/${slug}/session`
    deps.navigateWithSidebarReset(href)
  }
}

export function scrollToSession(
  container: HTMLDivElement | undefined,
  sessionId: string,
  sessionKey: string,
  current: string | undefined,
  setCurrent: (key: string) => void,
) {
  if (!container) return
  if (current === sessionKey) return
  const element = container.querySelector(`[data-session-id="${sessionId}"]`)
  if (!element) return
  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  if (elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom) {
    setCurrent(sessionKey)
    return
  }
  setCurrent(sessionKey)
  element.scrollIntoView({ block: "nearest", behavior: "smooth" })
}
