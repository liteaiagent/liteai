import { Binary } from "@liteai/util/binary"
import { base64Encode } from "@liteai/util/encode"
import { getFilename } from "@liteai/util/path"
import type { Session } from "@liteai-ai/sdk/client"
import { type Accessor, untrack } from "solid-js"
import { produce } from "solid-js/store"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { LocalProject, useLayout } from "@/context/layout"
import type { useNotification } from "@/context/notification"
import type { useServer } from "@/context/server"
import { setSessionHandoff } from "@/pages/session/handoff"
import { collectNewSessionDeepLinks, collectOpenProjectDeepLinks } from "./deep-links"
import { effectiveWorkspaceOrder, latestRootSession, workspaceKey } from "./helpers"

export type NavigationDeps = {
  globalSDK: ReturnType<typeof useGlobalSDK>
  globalSync: ReturnType<typeof useGlobalSync>
  layout: ReturnType<typeof useLayout>
  notification: ReturnType<typeof useNotification>
  server: ReturnType<typeof useServer>
  params: { dir?: string; id?: string }
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
  if (deps.server.projects.last() !== root) deps.server.projects.touch(root)
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
  deps.server.projects.touch(root)
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
    const listed = await deps.globalSDK.client.worktree
      .list({ directory: root })
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
      deps.navigateWithSidebarReset(`/${base64Encode(target.directory)}/session/${target.id}`)
      return true
    }
    const resolved = await deps.globalSDK.client.session
      .get({ sessionID: target.id })
      .then((x) => x.data)
      .catch(() => undefined)
    if (!resolved?.directory) return false
    if (!canOpen(resolved.directory)) return false
    ;(deps.setStore as (...a: unknown[]) => void)("lastProjectSession", root, {
      directory: resolved.directory,
      id: resolved.id,
      at: Date.now(),
    })
    deps.navigateWithSidebarReset(`/${base64Encode(resolved.directory)}/session/${resolved.id}`)
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
        session: await deps.globalSDK.client.session
          .list({ directory: item })
          .then((x) => x.data ?? [])
          .catch(() => []),
      })),
    ),
    Date.now(),
  )
  if (fetched && (await openSession(fetched))) {
    return
  }

  deps.navigateWithSidebarReset(`/${base64Encode(root)}/session`)
}

export function navigateToSession(deps: NavigationDeps, session: Session | undefined) {
  if (!session) return
  deps.navigateWithSidebarReset(`/${base64Encode(session.directory)}/session/${session.id}`)
}

export function openProject(deps: NavigationDeps, directory: string, nav = true) {
  deps.layout.projects.open(directory)
  if (nav) navigateToProject(deps, directory)
}

export function closeProject(deps: NavigationDeps, directory: string) {
  const list = deps.layout.projects.list()
  const index = list.findIndex((x) => x.worktree === directory)
  const active = deps.currentProject()?.worktree === directory
  if (index === -1) return
  const next = list[index + 1]

  if (!active) {
    deps.layout.projects.close(directory)
    return
  }

  if (!next) {
    deps.layout.projects.close(directory)
    deps.navigate("/")
    return
  }

  deps.navigateWithSidebarReset(`/${base64Encode(next.worktree)}/session`)
  deps.layout.projects.close(directory)
  queueMicrotask(() => {
    void navigateToProject(deps, next.worktree)
  })
}

export async function renameProject(deps: NavigationDeps, project: LocalProject, next: string) {
  const current = project.name || getFilename(project.worktree)
  if (next === current) return
  const name = next === getFilename(project.worktree) ? "" : next

  if (project.id && project.id !== "global") {
    await deps.globalSDK.client.project.update({ projectID: project.id, directory: project.worktree, name })
    return
  }

  deps.globalSync.project.meta(project.worktree, { name })
}

export function archiveSession(deps: NavigationDeps, session: Session) {
  const [store, setStore] = deps.globalSync.child(session.directory)
  const sessions = store.session ?? []
  const index = sessions.findIndex((s) => s.id === session.id)
  const next = sessions[index + 1] ?? sessions[index - 1]

  return deps.globalSDK.client.session
    .update({
      directory: session.directory,
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
          deps.navigate(`/${deps.params.dir}/session/${next.id}`)
        } else {
          deps.navigate(`/${deps.params.dir}/session`)
        }
      }
    })
}

export function deleteSession(deps: NavigationDeps, session: Session) {
  const [store, setStore] = deps.globalSync.child(session.directory)
  const sessions = store.session ?? []
  const index = sessions.findIndex((s) => s.id === session.id)
  const next = sessions[index + 1] ?? sessions[index - 1]

  return deps.globalSDK.client.session
    .delete({
      directory: session.directory,
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
          deps.navigate(`/${deps.params.dir}/session/${next.id}`)
        } else {
          deps.navigate(`/${deps.params.dir}/session`)
        }
      }
    })
}

export function renameSession(deps: NavigationDeps, session: Session, title: string) {
  const [, setStore] = deps.globalSync.child(session.directory)
  return deps.globalSDK.client.session
    .update({
      directory: session.directory,
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

export function handleDeepLinks(deps: NavigationDeps, urls: string[]) {
  if (!deps.server.isLocal()) return

  for (const directory of collectOpenProjectDeepLinks(urls)) {
    openProject(deps, directory)
  }

  for (const link of collectNewSessionDeepLinks(urls)) {
    openProject(deps, link.directory, false)
    const slug = base64Encode(link.directory)
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
