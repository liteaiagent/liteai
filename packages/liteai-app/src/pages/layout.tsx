import { useDialog } from "@liteai/ui/context/dialog"
import { useTheme } from "@liteai/ui/theme"
import { getFilename } from "@liteai/util/path"
import type { Session } from "@liteai-ai/sdk/client"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { createEffect, createMemo, on, onCleanup, onMount, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { DialogEditProject } from "@/components/dialog-edit-project"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogSettings } from "@/components/dialog-settings"
import { useCommand } from "@/context/command"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { type LocalProject, useLayout } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { createAim } from "@/utils/aim"
import { decode64 } from "@/utils/base64"
import { setNavigate } from "@/utils/notification-click"
import { Persist, persisted } from "@/utils/persist"
import { getDraggableId } from "@/utils/solid-dnd"
import { registerCommands } from "./layout/commands"
import { deepLinkEvent, drainPendingDeepLinks } from "./layout/deep-links"
import { effectiveWorkspaceOrder, sortedRootSessions, workspaceKey } from "./layout/helpers"
import { createInlineEditorController } from "./layout/inline-editor"
import {
  activeProjectRoot,
  clearLastProjectSession,
  closeProject,
  archiveProject as doArchiveProject,
  archiveSession as doArchiveSession,
  deleteSession as doDeleteSession,
  renameSession as doRenameSession,
  restoreSession as doRestoreSession,
  handleDeepLinks,
  type NavigationDeps,
  navigateSessionByOffset,
  navigateSessionByUnseen,
  navigateToProject,
  openProject,
  rememberSessionRoute,
  renameProject,
  scrollToSession,
  syncSessionRoute,
  touchProjectRoute,
} from "./layout/navigation"
import { useSDKNotificationToasts, useUpdatePolling } from "./layout/notifications"
import { createPrefetch } from "./layout/prefetch"
import { LayoutShell } from "./layout/shell"
import { ProjectDragOverlay, type ProjectSidebarContext } from "./layout/sidebar-project"
import type { WorkspaceSidebarContext } from "./layout/sidebar-workspace"
import { DialogDeleteWorkspace, DialogResetWorkspace, type WorkspaceDialogDeps } from "./layout/workspace-dialogs"
import {
  createWorkspace as doCreateWorkspace,
  deleteWorkspace as doDeleteWorkspace,
  resetWorkspace as doResetWorkspace,
  type WorkspaceOpsDeps,
} from "./layout/workspace-ops"

export default function Layout(props: ParentProps) {
  const [store, setStore, , ready] = persisted(
    Persist.global("layout.page", ["layout.page.v1"]),
    createStore({
      lastProjectSession: {} as { [directory: string]: { directory: string; id: string; at: number } },
      activeProject: undefined as string | undefined,
      activeWorkspace: undefined as string | undefined,
      workspaceOrder: {} as Record<string, string[]>,
      workspaceName: {} as Record<string, string>,
      workspaceBranchName: {} as Record<string, Record<string, string>>,
      workspaceExpanded: {} as Record<string, boolean>,
      workspaceShowArchived: {} as Record<string, boolean>,
      gettingStartedDismissed: false,
    }),
  )

  const pageReady = createMemo(() => ready())

  let scrollContainerRef: HTMLDivElement | undefined

  const params = useParams()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const layoutReady = createMemo(() => layout.ready())
  const platform = usePlatform()
  const settings = useSettings()
  const server = useServer()
  const notification = useNotification()
  const permission = usePermission()
  const navigate = useNavigate()
  const location = useLocation()
  setNavigate(navigate)
  const dialog = useDialog()
  const command = useCommand()
  const theme = useTheme()
  const language = useLanguage()

  const currentDir = createMemo(() => globalSync.data.project.find((p) => p.id === params.projectID)?.worktree ?? "")

  const [state, setState] = createStore({
    autoselect: !params.projectID && location.pathname === "/",
    busyWorkspaces: {} as Record<string, boolean>,
    hoverSession: undefined as string | undefined,
    hoverProject: undefined as string | undefined,
    scrollSessionKey: undefined as string | undefined,
    nav: undefined as HTMLElement | undefined,
    sortNow: Date.now(),
    sizing: false,
    peek: undefined as string | undefined,
    peeked: false,
  })

  const editor = createInlineEditorController()
  const setBusy = (directory: string, value: boolean) => {
    const key = workspaceKey(directory)
    if (value) {
      setState("busyWorkspaces", key, true)
      return
    }
    setState(
      "busyWorkspaces",
      produce((draft) => {
        delete draft[key]
      }),
    )
  }
  const isBusy = (directory: string) => !!state.busyWorkspaces[workspaceKey(directory)]
  const navLeave = { current: undefined as number | undefined }
  const sortNow = () => state.sortNow
  const sizet = { current: undefined as number | undefined }
  let sortNowInterval: ReturnType<typeof setInterval> | undefined
  const sortNowTimeout = setTimeout(
    () => {
      setState("sortNow", Date.now())
      sortNowInterval = setInterval(() => setState("sortNow", Date.now()), 60_000)
    },
    60_000 - (Date.now() % 60_000),
  )

  // --- aim / hover / peek ---
  const aim = createAim({
    enabled: () => !layout.sidebar.opened(),
    active: () => state.hoverProject,
    el: () => state.nav?.querySelector<HTMLElement>("[data-component='sidebar-rail']") ?? state.nav,
    onActivate: (directory) => {
      globalSync.child(directory)
      setState("hoverProject", directory)
      setState("hoverSession", undefined)
    },
  })

  let peekt: number | undefined
  onCleanup(() => {
    if (navLeave.current !== undefined) clearTimeout(navLeave.current)
    clearTimeout(sortNowTimeout)
    if (sortNowInterval) clearInterval(sortNowInterval)
    if (sizet.current !== undefined) clearTimeout(sizet.current)
    if (peekt !== undefined) clearTimeout(peekt)
    aim.reset()
  })

  onMount(() => {
    const stop = () => setState("sizing", false)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    window.addEventListener("blur", stop)
    onCleanup(() => {
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      window.removeEventListener("blur", stop)
    })
  })

  const sidebarHovering = createMemo(() => !layout.sidebar.opened() && state.hoverProject !== undefined)
  const sidebarExpanded = createMemo(() => layout.sidebar.opened() || sidebarHovering())
  const setHoverProject = (value: string | undefined) => {
    setState("hoverProject", value)
    if (value !== undefined) return
    aim.reset()
  }
  const clearHoverProjectSoon = () => queueMicrotask(() => setHoverProject(undefined))
  const setHoverSession = (id: string | undefined) => setState("hoverSession", id)

  const disarm = () => {
    if (navLeave.current === undefined) return
    clearTimeout(navLeave.current)
    navLeave.current = undefined
  }
  const arm = () => {
    if (layout.sidebar.opened()) return
    if (state.hoverProject === undefined) return
    disarm()
    navLeave.current = window.setTimeout(() => {
      navLeave.current = undefined
      setHoverProject(undefined)
      setState("hoverSession", undefined)
    }, 300)
  }

  const hoverProjectData = createMemo(() => {
    const id = state.hoverProject
    if (!id) return
    return layout.projects.list().find((project) => project.worktree === id)
  })
  const peekProject = createMemo(() => {
    const id = state.peek
    if (!id) return
    return layout.projects.list().find((project) => project.worktree === id)
  })

  createEffect(() => {
    const p = hoverProjectData()
    if (p) {
      if (peekt !== undefined) {
        clearTimeout(peekt)
        peekt = undefined
      }
      setState("peek", p.worktree)
      setState("peeked", true)
      return
    }
    setState("peeked", false)
    if (state.peek === undefined) return
    if (peekt !== undefined) clearTimeout(peekt)
    peekt = window.setTimeout(() => {
      peekt = undefined
      setState("peek", undefined)
    }, 180)
  })

  createEffect(() => {
    if (!layout.sidebar.opened()) return
    setHoverProject(undefined)
  })

  const clearSidebarHoverState = () => {
    if (layout.sidebar.opened()) return
    setState("hoverSession", undefined)
    setHoverProject(undefined)
  }
  const navigateWithSidebarReset = (href: string) => {
    clearSidebarHoverState()
    navigate(href)
    layout.mobileSidebar.hide()
  }

  // --- workspace name ---
  const workspaceName = (directory: string, projectId?: string, branch?: string) => {
    const key = workspaceKey(directory)
    const direct = store.workspaceName[key] ?? store.workspaceName[directory]
    if (direct) return direct
    if (!projectId) return
    if (!branch) return
    return store.workspaceBranchName[projectId]?.[branch]
  }
  const setWorkspaceName = (directory: string, next: string, projectId?: string, branch?: string) => {
    const key = workspaceKey(directory)
    setStore("workspaceName", key, next)
    if (!projectId) return
    if (!branch) return
    if (!store.workspaceBranchName[projectId]) setStore("workspaceBranchName", projectId, {})
    setStore("workspaceBranchName", projectId, branch, next)
  }
  const workspaceLabel = (directory: string, branch?: string, projectId?: string) =>
    workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)
  const renameWorkspace = (directory: string, next: string, projectId?: string, branch?: string) => {
    const current = workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)
    if (current === next) return
    setWorkspaceName(directory, next, projectId, branch)
  }

  // --- current project / sessions ---
  const currentProject = createMemo(() => {
    const directory = currentDir()
    if (!directory) return
    const projects = layout.projects.list()
    const key = workspaceKey(directory)
    const sandbox = projects.find((p) => p.sandboxes?.some((s) => workspaceKey(s) === key))
    if (sandbox) return sandbox
    const direct = projects.find((p) => workspaceKey(p.worktree) === key)
    if (direct) return direct
    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return
    const meta = globalSync.data.project.find((p) => p.id === id)
    const root = meta?.worktree
    if (!root) return
    return projects.find((p) => workspaceKey(p.worktree) === workspaceKey(root))
  })

  const workspaceSetting = createMemo(() => {
    const project = currentProject()
    if (!project) return false
    if (project.vcs !== "git") return false
    return layout.sidebar.workspaces(project.worktree)()
  })

  function workspaceIdsSync(project: LocalProject | undefined) {
    if (!project) return [] as string[]
    const local = project.worktree
    const dirs = [local, ...(project.sandboxes ?? [])]
    const active = currentProject()
    const directory = active?.worktree === project.worktree ? currentDir() : undefined
    const extra = directory && directory !== local && !dirs.includes(directory) ? directory : undefined
    const ordered = effectiveWorkspaceOrder(local, dirs, store.workspaceOrder[project.worktree])
    if (!extra) return ordered
    return [...ordered, extra]
  }

  const visibleSessionDirs = createMemo(() => {
    const project = currentProject()
    if (!project) return [] as string[]
    if (!workspaceSetting()) return [project.worktree]
    const activeDir = currentDir()
    return workspaceIdsSync(project).filter((directory) => {
      const expanded = store.workspaceExpanded[directory] ?? directory === project.worktree
      return expanded || directory === activeDir
    })
  })

  const currentSessions = createMemo(() => {
    const now = Date.now()
    const dirs = visibleSessionDirs()
    if (dirs.length === 0) return [] as Session[]
    const result: Session[] = []
    for (const dir of dirs) {
      const [dirStore] = globalSync.child(dir, { bootstrap: true })
      result.push(...sortedRootSessions(dirStore, now))
    }
    return result
  })

  // --- prefetch ---
  const prefetch = createPrefetch({ globalSDK, globalSync, params, visibleSessionDirs })

  // --- navigation deps ---
  const navDeps: NavigationDeps = {
    globalSDK,
    globalSync,
    layout,
    notification,
    server,
    params,
    navigate,
    currentDir,
    navigateWithSidebarReset,
    currentProject,
    store,
    setStore: setStore as (...args: unknown[]) => void,
    prefetchSession: prefetch.prefetchSession,
    warm: prefetch.warm,
    currentSessions,
  }

  // --- workspace ops deps ---
  const wsDeps: WorkspaceOpsDeps = {
    globalSDK,
    globalSync,
    language,
    layout,
    platform,
    params,
    navigate,
    currentDir,
    navigateWithSidebarReset,
    clearSidebarHoverState,
    setBusy,
    store,
    setStore: setStore as (...args: unknown[]) => void,
    setWorkspaceName,
    clearLastProjectSession: (root: string) => clearLastProjectSession(navDeps, root),
  }

  // --- autoselect ---
  const autoselecting = createMemo(() => {
    if (params.projectID) return false
    if (!state.autoselect) return false
    if (!pageReady()) return true
    if (!layoutReady()) return true
    if (layout.projects.list().length > 0) return true
    return !!layout.projects.last()
  })

  createEffect(() => {
    if (!state.autoselect) return
    if (!params.projectID) return
    if (!globalSync.data.project.find((p) => p.id === params.projectID)?.worktree) return
    setState("autoselect", false)
  })

  createEffect(
    on(
      () => ({ ready: pageReady(), layoutReady: layoutReady(), dir: params.projectID, list: layout.projects.list() }),
      (value) => {
        if (!value.ready || !value.layoutReady || !state.autoselect || value.dir) return
        const last = layout.projects.last()

        if (value.list.length === 0 || !last) {
          setState("autoselect", false)
          return
        }

        const lastKey = workspaceKey(last)
        const next = value.list.find((p) => workspaceKey(p.worktree) === lastKey)

        if (!next) {
          setState("autoselect", false)
          return
        }

        setState("autoselect", false)
        // Soft select without triggering heavy API calls (preventing "open actions")
        layout.projects.open(next.worktree)
        navigateToProject(navDeps, next.worktree)
      },
    ),
  )

  // --- workspace expanded cleanup ---
  createEffect(() => {
    if (!pageReady() || !layoutReady()) return
    for (const [directory, expanded] of Object.entries(store.workspaceExpanded)) {
      if (!expanded) continue
      const project = layout.projects
        .list()
        .find(
          (item) =>
            workspaceKey(item.worktree) === workspaceKey(directory) ||
            item.sandboxes?.some((s) => workspaceKey(s) === workspaceKey(directory)),
        )
      if (!project) continue
      if (project.vcs === "git" && layout.sidebar.workspaces(project.worktree)()) continue
      setStore("workspaceExpanded", directory, false)
    }
  })

  // --- prefetch on session change ---
  createEffect(() => {
    const sessions = currentSessions()
    if (sessions.length === 0) return
    const index = params.id ? sessions.findIndex((s) => s.id === params.id) : 0
    if (index === -1) return
    if (!params.id) {
      const first = sessions[index]
      if (first) prefetch.prefetchSession(first, "high")
    }
    prefetch.warm(sessions, index)
  })

  // --- dialog helpers ---
  const connectProvider = () => dialog.show(() => <DialogSelectProvider />)
  const openServer = () => dialog.show(() => <DialogSelectServer />)
  const openSettings = (tab?: string) => dialog.show(() => <DialogSettings tab={tab} />)
  const showEditProjectDialog = (project: LocalProject) => dialog.show(() => <DialogEditProject project={project} />)
  const toggleProjectWorkspaces = (project: LocalProject) => {
    const enabled = layout.sidebar.workspaces(project.worktree)()
    if (enabled) {
      layout.sidebar.toggleWorkspaces(project.worktree)
      return
    }
    if (project.vcs !== "git") return
    layout.sidebar.toggleWorkspaces(project.worktree)
  }

  const chooseProject = async () => {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) openProject(navDeps, directory, false)
        navigateToProject(navDeps, result[0])
      } else if (result) {
        openProject(navDeps, result)
      }
    }
    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  // --- workspace dialog deps ---
  const wsDialogDeps: WorkspaceDialogDeps = {
    globalSDK,
    language,
    currentDir,
    navigateWithSidebarReset,
    deleteWorkspace: (root, dir, leave) => doDeleteWorkspace(wsDeps, root, dir, leave),
    resetWorkspace: (root, dir) => doResetWorkspace(wsDeps, root, dir),
  }

  // --- notifications & commands ---
  useUpdatePolling({ platform, language, settings })
  useSDKNotificationToasts({
    globalSDK,
    globalSync,
    language,
    settings,
    platform,
    permission,
    notification,
    navigate,
    currentDir,
    setBusy,
  })
  registerCommands({
    language,
    theme,
    command,
    currentProject,
    workspaceSetting,
    currentSessions,
    params,
    sidebarToggle: () => layout.sidebar.toggle(),
    chooseProject,
    connectProvider,
    openServer,
    openSettings,
    navigateSessionByOffset: (offset) => navigateSessionByOffset(navDeps, offset),
    navigateSessionByUnseen: (offset) => navigateSessionByUnseen(navDeps, offset),
    archiveSession: (session) => doArchiveSession(navDeps, session),
    createWorkspace: (project) => doCreateWorkspace(wsDeps, project),
    toggleWorkspaces: toggleProjectWorkspaces,
    toggleWorkspacesEnabled: (worktree) => layout.sidebar.workspaces(worktree),
  })

  // --- deep links ---
  onMount(() => {
    const handler = (event: Event) => {
      const urls = (event as CustomEvent<{ urls: string[] }>).detail?.urls ?? []
      if (urls.length === 0) return
      handleDeepLinks(navDeps, urls)
    }
    handleDeepLinks(navDeps, drainPendingDeepLinks(window))
    window.addEventListener(deepLinkEvent, handler as EventListener)
    onCleanup(() => window.removeEventListener(deepLinkEvent, handler as EventListener))
  })

  // --- route tracking ---
  const activeRoute = { session: "", sessionProject: "" }
  createEffect(
    on(
      () => [pageReady(), params.projectID, params.id, currentProject()?.worktree] as const,
      ([ready, dir, id]) => {
        if (!ready || !dir) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          return
        }
        const directory = decode64(dir)
        if (!directory) return
        const root = touchProjectRoute(navDeps) ?? activeProjectRoot(navDeps, directory)
        if (!id) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          return
        }
        const session = `${dir}/${id}`
        if (session !== activeRoute.session) {
          activeRoute.session = session
          activeRoute.sessionProject = syncSessionRoute(navDeps, directory, id, root)
          requestAnimationFrame(() =>
            scrollToSession(scrollContainerRef, id, `${directory}:${id}`, state.scrollSessionKey, (k) =>
              setState("scrollSessionKey", k),
            ),
          )
          return
        }
        if (root === activeRoute.sessionProject) return
        activeRoute.sessionProject = rememberSessionRoute(navDeps, directory, id, root)
      },
    ),
  )

  createEffect(() => {
    const w = layout.sidebar.opened() ? layout.sidebar.width() : 48
    document.documentElement.style.setProperty("--dialog-left-margin", `${w}px`)
  })

  // --- session dir loading ---
  const loadedSessionDirs = new Set<string>()
  createEffect(
    on(
      visibleSessionDirs,
      (dirs) => {
        if (dirs.length === 0) {
          loadedSessionDirs.clear()
          return
        }
        const next = new Set(dirs)
        for (const directory of next) {
          if (!loadedSessionDirs.has(directory)) globalSync.project.loadSessions(directory)
        }
        loadedSessionDirs.clear()
        for (const directory of next) loadedSessionDirs.add(directory)
      },
      { defer: true },
    ),
  )

  // --- drag handlers ---
  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setHoverProject(undefined)
    setStore("activeProject", id)
  }
  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return
    const projects = layout.projects.list()
    const from = projects.findIndex((p) => p.worktree === draggable.id.toString())
    const to = projects.findIndex((p) => p.worktree === droppable.id.toString())
    if (from !== to && to !== -1) layout.projects.move(draggable.id.toString(), to)
  }
  const handleDragEnd = () => setStore("activeProject", undefined)

  const sidebarProject = createMemo(() => {
    if (layout.sidebar.opened()) return currentProject()
    return hoverProjectData() ?? currentProject()
  })

  const handleWorkspaceDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeWorkspace", id)
  }
  const handleWorkspaceDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return
    const project = sidebarProject()
    if (!project) return
    const ids = workspaceIdsSync(project)
    const from = ids.indexOf(draggable.id.toString())
    const to = ids.indexOf(droppable.id.toString())
    if (from === -1 || to === -1 || from === to) return
    const result = ids.slice()
    const [item] = result.splice(from, 1)
    if (!item) return
    result.splice(to, 0, item)
    setStore(
      "workspaceOrder",
      project.worktree,
      result.filter((d) => workspaceKey(d) !== workspaceKey(project.worktree)),
    )
  }
  const handleWorkspaceDragEnd = () => setStore("activeWorkspace", undefined)

  // --- context objects ---
  const workspaceSidebarCtx: WorkspaceSidebarContext = {
    currentDir,
    navList: currentSessions,
    sidebarExpanded,
    sidebarHovering,
    nav: () => state.nav,
    hoverSession: () => state.hoverSession,
    setHoverSession,
    clearHoverProjectSoon,
    prefetchSession: prefetch.prefetchSession,
    archiveSession: (session) => doArchiveSession(navDeps, session),
    restoreSession: (session) => doRestoreSession(navDeps, session),
    deleteSession: (session) => doDeleteSession(navDeps, session),
    renameSession: (session, title) => doRenameSession(navDeps, session, title),
    workspaceName,
    renameWorkspace,
    editorOpen: editor.editorOpen,
    openEditor: editor.openEditor,
    closeEditor: editor.closeEditor,
    setEditor: editor.setEditor,
    InlineEditor: editor.InlineEditor,
    isBusy,
    workspaceExpanded: (directory, local) => store.workspaceExpanded[directory] ?? local,
    setWorkspaceExpanded: (directory, value) => setStore("workspaceExpanded", directory, value),
    showArchived: (directory) => store.workspaceShowArchived[directory] ?? false,
    setShowArchived: (directory, value) => setStore("workspaceShowArchived", directory, value),
    showResetWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogResetWorkspace root={root} directory={directory} deps={wsDialogDeps} />),
    showDeleteWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogDeleteWorkspace root={root} directory={directory} deps={wsDialogDeps} />),
    setScrollContainerRef: (el, mobile) => {
      if (!mobile) scrollContainerRef = el
    },
  }

  const projectSidebarCtx: ProjectSidebarContext = {
    currentDir,
    sidebarOpened: () => layout.sidebar.opened(),
    sidebarHovering,
    hoverProject: () => state.hoverProject,
    nav: () => state.nav,
    onProjectMouseEnter: (worktree, event) => aim.enter(worktree, event),
    onProjectMouseLeave: (worktree) => aim.leave(worktree),
    onProjectFocus: (worktree) => aim.activate(worktree),
    navigateToProject: (dir) => navigateToProject(navDeps, dir),
    openSidebar: () => layout.sidebar.open(),
    closeProject: (dir) => closeProject(navDeps, dir),
    archiveProject: (dir) => doArchiveProject(navDeps, dir),
    showEditProjectDialog,
    toggleProjectWorkspaces,
    workspacesEnabled: (project) => project.vcs === "git" && layout.sidebar.workspaces(project.worktree)(),
    workspaceIds: workspaceIdsSync,
    workspaceLabel,
    sessionProps: {
      navList: currentSessions,
      sidebarExpanded,
      sidebarHovering,
      nav: () => state.nav,
      hoverSession: () => state.hoverSession,
      setHoverSession,
      clearHoverProjectSoon,
      prefetchSession: prefetch.prefetchSession,
      archiveSession: (session) => doArchiveSession(navDeps, session),
      deleteSession: (session) => doDeleteSession(navDeps, session),
      renameSession: (session, title) => doRenameSession(navDeps, session, title),
    },
    setHoverSession,
  }

  if (location.pathname === "/log") return <>{props.children}</>

  return (
    <LayoutShell
      language={language}
      layout={layout}
      platform={platform}
      command={command}
      sizing={state.sizing}
      peeked={state.peeked}
      sidebarHovering={sidebarHovering}
      autoselecting={autoselecting}
      setNav={(el) => setState("nav", el)}
      setSizing={(value) => setState("sizing", value)}
      sizet={sizet}
      disarm={disarm}
      arm={arm}
      aimReset={aim.reset}
      aimMove={aim.move}
      projects={() => layout.projects.list()}
      projectSidebarCtx={projectSidebarCtx}
      sortNow={sortNow}
      handleDragStart={handleDragStart}
      handleDragEnd={handleDragEnd}
      handleDragOver={handleDragOver}
      projectOverlay={() => (
        <ProjectDragOverlay projects={() => layout.projects.list()} activeProject={() => store.activeProject} />
      )}
      chooseProject={chooseProject}
      openSettings={openSettings}
      currentProject={currentProject}
      peekProject={peekProject}
      panelProps={{
        sidebarOpened: () => layout.sidebar.opened(),
        sidebarWidth: () => layout.sidebar.width(),
        language,
        workspaceSidebarCtx,
        renameProject: (p: LocalProject, next: string) => renameProject(navDeps, p, next),
        closeProject: (dir: string) => closeProject(navDeps, dir),
        showEditProjectDialog,
        toggleProjectWorkspaces,
        navigateWithSidebarReset,
        connectProvider,
        createWorkspace: (project: LocalProject) => doCreateWorkspace(wsDeps, project),
        InlineEditor: editor.InlineEditor,
        workspaceIds: workspaceIdsSync,
        workspacesEnabled: (project: LocalProject) =>
          project.vcs === "git" && layout.sidebar.workspaces(project.worktree)(),
        workspaceLabel,
        sidebarHovering,
        handleWorkspaceDragStart,
        handleWorkspaceDragEnd,
        handleWorkspaceDragOver,
        sidebarProject,
        activeWorkspace: () => store.activeWorkspace,
        sortNow,
        gettingStartedDismissed: store.gettingStartedDismissed,
        dismissGettingStarted: () => setStore("gettingStartedDismissed", true),
        homedir: createMemo(() => globalSync.data.path.home),
      }}
    >
      {props.children}
    </LayoutShell>
  )
}
