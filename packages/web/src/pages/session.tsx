import type { UserMessage } from "@liteai/sdk"
import { useDialog } from "@liteai/ui/context/dialog"
import { createAutoScroll } from "@liteai/ui/hooks"
import { ResizeHandle } from "@liteai/ui/resize-handle"
import { Tabs } from "@liteai/ui/tabs"
import { showToast } from "@liteai/ui/toast"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useNavigate, useSearchParams } from "@solidjs/router"
import {
  batch,
  createComputed,
  createEffect,
  createMemo,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from "solid-js"
import { createStore } from "solid-js/store"
import { type FollowupDraft, sendFollowupDraft } from "@/components/prompt-input/submit"
import { NewSessionView, SessionHeader } from "@/components/session"
import { useComments } from "@/context/comments"
import { useFile } from "@/context/file"
import { useGlobalSync } from "@/context/global-sync"
import { getSessionPrefetch, SESSION_PREFETCH_TTL } from "@/context/global-sync/session-prefetch"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { createSessionComposerState, SessionComposerRegion } from "@/pages/session/composer"
import { createSessionTabs, createSizing, focusTerminalById } from "@/pages/session/helpers"
import { createSessionHistoryWindow, emptyUserMessages } from "@/pages/session/history-window"
import { MessageTimeline } from "@/pages/session/message-timeline"
import { useSessionLayout } from "@/pages/session/session-layout"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import { createSessionReview } from "@/pages/session/session-review"
import { SessionSidePanel } from "@/pages/session/session-side-panel"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { TracePanel } from "@/pages/session/trace-panel"
import { useSessionCommands } from "@/pages/session/use-session-commands"
import { useSessionHashScroll } from "@/pages/session/use-session-hash-scroll"
import { Identifier } from "@/utils/id"
import { toProjectID } from "@/utils/project-id"
import { extractPromptFromParts } from "@/utils/prompt"
import { same } from "@/utils/same"
import { formatServerError } from "@/utils/server-errors"

const emptyFollowups: (FollowupDraft & { id: string })[] = []

export default function Page() {
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()
  const settings = useSettings()
  const prompt = usePrompt()
  const comments = useComments()
  const terminal = useTerminal()
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string }>()
  const { params, sessionKey, tabs, view } = useSessionLayout()

  createEffect(() => {
    if (!untrack(() => prompt.ready())) return
    prompt.ready()
    untrack(() => {
      if (params.id || !prompt.ready()) return
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearchParams({ ...searchParams, prompt: undefined })
    })
  })

  const [ui, setUi] = createStore({
    git: false,
    pendingMessage: undefined as string | undefined,
    restoring: undefined as string | undefined,
    reverting: false,
    reviewSnap: false,
    scrollGesture: 0,
    scroll: {
      overflow: false,
      bottom: true,
    },
  })

  const composer = createSessionComposerState()

  const workspaceKey = createMemo(() => params.projectID ?? "")
  const workspaceTabs = createMemo(() => layout.tabs(workspaceKey))

  createEffect(
    on(
      () => params.id,
      (id, prev) => {
        if (!id) return
        if (prev) return

        const pending = layout.handoff.tabs()
        if (!pending) return
        if (Date.now() - pending.at > 60_000) {
          layout.handoff.clearTabs()
          return
        }

        if (pending.id !== id) return
        layout.handoff.clearTabs()
        if (pending.dir !== (params.projectID ?? "")) return

        const from = workspaceTabs().tabs()
        if (from.all.length === 0 && !from.active) return

        const current = tabs().tabs()
        if (current.all.length > 0 || current.active) return

        const all = normalizeTabs(from.all)
        const active = from.active ? normalizeTab(from.active) : undefined
        tabs().setAll(all)
        tabs().setActive(active && all.includes(active) ? active : all[0])

        workspaceTabs().setAll([])
        workspaceTabs().setActive(undefined)
      },
      { defer: true },
    ),
  )

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const size = createSizing()
  const desktopReviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const desktopFileTreeOpen = createMemo(() => isDesktop() && layout.fileTree.opened())
  const desktopSidePanelOpen = createMemo(() => desktopReviewOpen() || desktopFileTreeOpen())
  const traceOpen = createMemo(() => isDesktop() && view().trace.opened())
  const traceWidth = createMemo(() => (traceOpen() ? layout.trace.width() : 0))
  const sessionPanelWidth = createMemo(() => {
    const tw = traceWidth()
    if (!desktopSidePanelOpen()) return tw ? `calc(100% - ${tw}px)` : "100%"
    if (desktopReviewOpen()) return `${layout.session.width()}px`
    return `calc(100% - ${layout.fileTree.width() + tw}px)`
  })
  const centered = createMemo(() => isDesktop() && !desktopReviewOpen())

  function normalizeTab(tab: string) {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  function normalizeTabs(list: string[]) {
    const seen = new Set<string>()
    const next: string[] = []
    for (const item of list) {
      const value = normalizeTab(item)
      if (seen.has(value)) continue
      seen.add(value)
      next.push(value)
    }
    return next
  }

  const _openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))
  const reviewTab = createMemo(() => isDesktop())

  const review = createSessionReview({
    sessionID: () => params.id,
    sessionKey,
    info,
    diffs,
    lastUserMessage: () => lastUserMessage(),
    isDesktop,
    desktopReviewOpen,
    desktopFileTreeOpen,
    activeTab: () => tabState.activeTab(),
    mobileTab: () => store.mobileTab,
    changes: () => store.changes,
    setChanges: (value) => setStore("changes", value),
    deferRender: () => store.deferRender,
    tabs: () => tabs(),
    sync,
    sdk,
    file,
    comments,
    language,
    layout,
    prompt,
    globalSync,
    view,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: review.hasReview,
  })
  const _contextOpen = tabState.contextOpen
  const _openedTabs = tabState.openedTabs
  const _activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const messagesReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    return sync.data.message[id] !== undefined
  })
  const historyMore = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.more(id)
  })
  const historyLoading = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.loading(id)
  })

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )
  const visibleUserMessages = createMemo(
    () => {
      const revert = revertMessageID()
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    {
      equals: same,
    },
  )
  const lastUserMessage = createMemo(() => visibleUserMessages().at(-1))

  createEffect(() => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (path) file.load(path)
  })

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        syncSessionModel(local, msg)
      },
    ),
  )

  createEffect(
    on(
      () => ({ dir: params.projectID, id: params.id }),
      (next, prev) => {
        if (!prev) return
        if (next.dir === prev.dir && next.id === prev.id) return
        if (prev.id && !next.id) local.session.reset()
      },
      { defer: true },
    ),
  )

  const [store, setStore] = createStore({
    messageId: undefined as string | undefined,
    mobileTab: "session" as "session" | "changes",
    changes: "session" as "session" | "turn",
    newSessionWorktree: "main",
    deferRender: false,
  })

  const [followup, setFollowup] = createStore({
    items: {} as Record<string, (FollowupDraft & { id: string })[] | undefined>,
    sending: {} as Record<string, string | undefined>,
    failed: {} as Record<string, string | undefined>,
    paused: {} as Record<string, boolean | undefined>,
    edit: {} as Record<
      string,
      { id: string; prompt: FollowupDraft["prompt"]; context: FollowupDraft["context"] } | undefined
    >,
  })

  createComputed((prev) => {
    const key = sessionKey()
    if (key !== prev) {
      setStore("deferRender", true)
      requestAnimationFrame(() => {
        setTimeout(() => setStore("deferRender", false), 0)
      })
    }
    return key
  }, sessionKey())

  let reviewFrame: number | undefined
  let refreshFrame: number | undefined
  let refreshTimer: number | undefined

  createComputed((prev) => {
    const open = desktopReviewOpen()
    if (prev === undefined || prev === open) return open

    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    setUi("reviewSnap", true)
    reviewFrame = requestAnimationFrame(() => {
      reviewFrame = undefined
      setUi("reviewSnap", false)
    })
    return open
  }, desktopReviewOpen())

  const newSessionWorktree = createMemo(() => {
    if (store.newSessionWorktree === "create") return "create"
    const project = sync.project
    if (project && sdk.directory !== project.worktree) return sdk.directory
    return "main"
  })

  const setActiveMessage = (message: UserMessage | undefined) => {
    messageMark = scrollMark
    setStore("messageId", message?.id)
  }

  const anchor = (id: string) => `message-${id}`

  const cursor = () => {
    const root = scroller
    if (!root) return store.messageId

    const box = root.getBoundingClientRect()
    const line = box.top + 100
    const list = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
      .map((el) => {
        const id = el.dataset.messageId
        if (!id) return undefined

        const rect = el.getBoundingClientRect()
        return { id, top: rect.top, bottom: rect.bottom }
      })
      .filter((item): item is { id: string; top: number; bottom: number } => !!item)

    const shown = list.filter((item) => item.bottom > box.top && item.top < box.bottom)
    const hit = shown.find((item) => item.top <= line && item.bottom >= line)
    if (hit) return hit.id

    const near = [...shown].sort((a, b) => {
      const da = Math.abs(a.top - line)
      const db = Math.abs(b.top - line)
      if (da !== db) return da - db
      return a.top - b.top
    })[0]
    if (near) return near.id

    return list.filter((item) => item.top <= line).at(-1)?.id ?? list[0]?.id ?? store.messageId
  }

  function navigateMessageByOffset(offset: number) {
    const msgs = visibleUserMessages()
    if (msgs.length === 0) return

    const current = store.messageId && messageMark === scrollMark ? store.messageId : cursor()
    const base = current ? msgs.findIndex((m) => m.id === current) : msgs.length
    const currentIndex = base === -1 ? msgs.length : base
    const targetIndex = currentIndex + offset
    if (targetIndex < 0 || targetIndex > msgs.length) return

    if (targetIndex === msgs.length) {
      resumeScroll()
      return
    }

    autoScroll.pause()
    scrollToMessage(msgs[targetIndex], "auto")
  }

  let inputRef!: HTMLDivElement
  let promptDock: HTMLDivElement | undefined
  let dockHeight = 0
  let scroller: HTMLElement | undefined
  let content: HTMLElement | undefined
  let scrollMark = 0
  let messageMark = 0

  const scrollGestureWindowMs = 250

  const markScrollGesture = (target?: EventTarget | null) => {
    const root = scroller
    if (!root) return

    const el = target instanceof Element ? target : undefined
    const nested = el?.closest("[data-scrollable]")
    if (nested && nested !== root) return

    setUi("scrollGesture", Date.now())
  }

  const hasScrollGesture = () => Date.now() - ui.scrollGesture < scrollGestureWindowMs

  createEffect(
    on([() => sdk.directory, () => params.id] as const, ([, id]) => {
      if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshFrame = undefined
      refreshTimer = undefined
      if (!id) return

      const cached = untrack(() => sync.data.message[id] !== undefined)
      const stale = !cached
        ? false
        : (() => {
            const info = getSessionPrefetch(sdk.directory, id)
            if (!info) return true
            return Date.now() - info.at > SESSION_PREFETCH_TTL
          })()
      const todos = untrack(() => sync.data.todo[id] !== undefined || globalSync.data.session_todo[id] !== undefined)

      untrack(() => {
        void sync.session.sync(id)
      })

      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = undefined
        refreshTimer = window.setTimeout(() => {
          refreshTimer = undefined
          if (params.id !== id) return
          untrack(() => {
            if (stale) void sync.session.sync(id, { force: true })
            void sync.session.todo(id, todos ? { force: true } : undefined)
          })
        }, 0)
      })
    }),
  )

  createEffect(
    on(
      () => visibleUserMessages().at(-1)?.id,
      (lastId, prevLastId) => {
        if (lastId && prevLastId && lastId > prevLastId) {
          setStore("messageId", undefined)
        }
      },
      { defer: true },
    ),
  )

  // Session-local state: reset when session identity changes.
  // Consolidated from two separate effects; onCleanup fires before the
  // next sessionKey run and on disposal.
  createEffect(() => {
    sessionKey()
    onCleanup(() => {
      setStore("messageId", undefined)
      setStore("changes", "session")
      setUi("pendingMessage", undefined)
      review.setTree({
        reviewScroll: undefined,
        pendingDiff: undefined,
        activeDiff: undefined,
      })
    })
  })

  // Dir-local state: reset when workspace directory changes.
  createEffect(() => {
    if (!params.projectID) return
    params.projectID
    onCleanup(() => setStore("newSessionWorktree", "main"))
  })

  const isEditableTarget = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
  }

  const deepActiveElement = () => {
    let current: Element | null = document.activeElement
    while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement
    }
    return current instanceof HTMLElement ? current : undefined
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const activeElement = deepActiveElement()

    const protectedTarget = path.some(
      (item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null,
    )
    if (protectedTarget || isEditableTarget(target)) return

    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = isEditableTarget(activeElement)
      if (isProtected || isInput) return
    }
    if (dialog.active) return

    if (activeElement === inputRef) {
      if (event.key === "Escape") inputRef?.blur()
      return
    }

    // Prefer the open terminal over the composer when it can take focus
    if (view().terminal.opened()) {
      const id = terminal.active()
      if (id && focusTerminalById(id)) return
    }

    // Only treat explicit scroll keys as potential "user scroll" gestures.
    if (event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End") {
      markScrollGesture()
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      if (composer.blocked()) return
      inputRef?.focus()
    }
  }

  const mobileChanges = createMemo(() => !isDesktop() && store.mobileTab === "changes")

  const focusInput = () => inputRef?.focus()

  useSessionCommands({
    navigateMessageByOffset,
    setActiveMessage,
    focusInput,
    review: reviewTab,
  })

  createEffect(
    on(
      activeFileTab,
      (active) => {
        if (!active) return
        if (review.fileTreeTab() !== "changes") return
        review.showAllFiles()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => sdk.directory,
      () => {
        void file.tree.list("")

        const tab = activeFileTab()
        if (!tab) return
        const path = file.pathFromTab(tab)
        if (!path) return
        void file.load(path, { force: true })
      },
      { defer: true },
    ),
  )

  const autoScroll = createAutoScroll({
    working: () => true,
    overflowAnchor: "dynamic",
  })

  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLElement | undefined
  let fillFrame: number | undefined

  const updateScrollState = (el: HTMLElement) => {
    const max = el.scrollHeight - el.clientHeight
    const overflow = max > 1
    const bottom = !overflow || el.scrollTop >= max - 2

    if (ui.scroll.overflow === overflow && ui.scroll.bottom === bottom) return
    setUi("scroll", { overflow, bottom })
  }

  const scheduleScrollState = (el: HTMLElement) => {
    scrollStateTarget = el
    if (scrollStateFrame !== undefined) return

    scrollStateFrame = requestAnimationFrame(() => {
      scrollStateFrame = undefined

      const target = scrollStateTarget
      scrollStateTarget = undefined
      if (!target) return

      updateScrollState(target)
    })
  }

  const resumeScroll = () => {
    setStore("messageId", undefined)
    autoScroll.forceScrollToBottom()
    clearMessageHash()

    const el = scroller
    if (el) scheduleScrollState(el)
  }

  // When the user returns to the bottom, treat the active message as "latest".
  createEffect(
    on(
      autoScroll.userScrolled,
      (scrolled) => {
        if (scrolled) return
        setStore("messageId", undefined)
        clearMessageHash()
      },
      { defer: true },
    ),
  )

  let fill = () => {}

  const setScrollRef = (el: HTMLElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
    if (!el) return
    scheduleScrollState(el)
    fill()
  }

  const markUserScroll = () => {
    scrollMark += 1
  }

  createResizeObserver(
    () => content,
    () => {
      const el = scroller
      if (el) scheduleScrollState(el)
      fill()
    },
  )

  const historyWindow = createSessionHistoryWindow({
    sessionID: () => params.id,
    messagesReady,
    loaded: () => messages().length,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    userScrolled: autoScroll.userScrolled,
    scroller: () => scroller,
  })

  fill = () => {
    if (fillFrame !== undefined) return

    fillFrame = requestAnimationFrame(() => {
      fillFrame = undefined

      if (!params.id || !messagesReady()) return
      if (autoScroll.userScrolled() || historyLoading()) return

      const el = scroller
      if (!el) return
      if (el.scrollHeight > el.clientHeight + 1) return
      if (historyWindow.turnStart() <= 0 && !historyMore()) return

      void historyWindow.loadAndReveal()
    })
  }

  createEffect(
    on(
      () =>
        [
          params.id,
          messagesReady(),
          historyWindow.turnStart(),
          historyMore(),
          historyLoading(),
          autoScroll.userScrolled(),
          visibleUserMessages().length,
        ] as const,
      ([id, ready, start, more, loading, scrolled]) => {
        if (!id || !ready || loading || scrolled) return
        if (start <= 0 && !more) return
        fill()
      },
      { defer: true },
    ),
  )

  const draft = (id: string) =>
    extractPromptFromParts(sync.data.part[id] ?? [], {
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
    })

  const line = (id: string) => {
    const text = draft(id)
      .map((part) => (part.type === "image" ? `[image:${part.filename}]` : part.content))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(err, language.t),
    })
  }

  const merge = (next: NonNullable<ReturnType<typeof info>>) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === next.id)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = next
      return out
    })

  const roll = (sessionID: string, next: NonNullable<ReturnType<typeof info>>["revert"]) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === sessionID)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = { ...out[idx], revert: next }
      return out
    })

  const busy = (sessionID: string) => {
    if ((sync.data.session_status[sessionID] ?? { type: "idle" as const }).type !== "idle") return true
    return (sync.data.message[sessionID] ?? []).some(
      (item) => item.role === "assistant" && typeof item.time.completed !== "number",
    )
  }

  const queuedFollowups = createMemo(() => {
    const id = params.id
    if (!id) return emptyFollowups
    return followup.items[id] ?? emptyFollowups
  })

  const editingFollowup = createMemo(() => {
    const id = params.id
    if (!id) return
    return followup.edit[id]
  })

  const sendingFollowup = createMemo(() => {
    const id = params.id
    if (!id) return
    return followup.sending[id]
  })

  const queueEnabled = createMemo(() => {
    const id = params.id
    if (!id) return false
    return settings.general.followup() === "queue" && busy(id) && !composer.blocked()
  })

  const followupText = (item: FollowupDraft) => {
    const text = item.prompt
      .map((part) => {
        if (part.type === "image") return `[image:${part.filename}]`
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        return part.content
      })
      .join("")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => !!line)

    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const queueFollowup = (draft: FollowupDraft) => {
    setFollowup("items", draft.sessionID, (items) => [
      ...(items ?? []),
      { id: Identifier.ascending("message"), ...draft },
    ])
    setFollowup("failed", draft.sessionID, undefined)
    setFollowup("paused", draft.sessionID, undefined)
  }

  const followupDock = createMemo(() => queuedFollowups().map((item) => ({ id: item.id, text: followupText(item) })))

  const sendFollowup = (sessionID: string, id: string, opts?: { manual?: boolean }) => {
    const item = (followup.items[sessionID] ?? []).find((entry) => entry.id === id)
    if (!item) return Promise.resolve()
    if (followup.sending[sessionID]) return Promise.resolve()

    if (opts?.manual) setFollowup("paused", sessionID, undefined)
    setFollowup("sending", sessionID, id)
    setFollowup("failed", sessionID, undefined)

    return sendFollowupDraft({
      client: sdk.client,
      sync,
      globalSync,
      draft: item,
      optimisticBusy: item.sessionDirectory === sdk.directory,
    })
      .then((ok) => {
        if (ok === false) return
        setFollowup("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
        if (opts?.manual) resumeScroll()
      })
      .catch((err) => {
        setFollowup("failed", sessionID, id)
        fail(err)
      })
      .finally(() => {
        setFollowup("sending", sessionID, (value) => (value === id ? undefined : value))
      })
  }

  const editFollowup = (id: string) => {
    const sessionID = params.id
    if (!sessionID) return
    if (followup.sending[sessionID]) return

    const item = queuedFollowups().find((entry) => entry.id === id)
    if (!item) return

    setFollowup("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
    setFollowup("failed", sessionID, (value) => (value === id ? undefined : value))
    setFollowup("edit", sessionID, {
      id: item.id,
      prompt: item.prompt,
      context: item.context,
    })
  }

  const clearFollowupEdit = () => {
    const id = params.id
    if (!id) return
    setFollowup("edit", id, undefined)
  }

  const halt = (sessionID: string) =>
    busy(sessionID)
      ? sdk.client.project.session.abort({ sessionID, projectID: sdk.projectID }).catch(() => {})
      : Promise.resolve()

  const fork = (input: { sessionID: string; messageID: string }) => {
    const value = draft(input.messageID)
    const dir = toProjectID(sdk.directory)
    return sdk.client.project.session
      .fork({ ...input, projectID: sdk.projectID })
      .then((result) => {
        const next = result.data
        if (!next) {
          showToast({
            variant: "error",
            title: language.t("common.requestFailed"),
          })
          return
        }
        prompt.set(value, undefined, { projectID: sdk.projectID, id: next.id })
        navigate(`/${dir}/session/${next.id}`)
      })
      .catch(fail)
  }

  const revert = (input: { sessionID: string; messageID: string }) => {
    if (ui.reverting || ui.restoring) return
    const prev = prompt.current().slice()
    const last = info()?.revert
    const value = draft(input.messageID)
    batch(() => {
      setUi("reverting", true)
      roll(input.sessionID, { messageID: input.messageID })
      prompt.set(value)
    })
    return halt(input.sessionID)
      .then(() => sdk.client.project.session.revert({ ...input, projectID: sdk.projectID }))
      .then((result) => {
        if (result.data) merge(result.data)
      })
      .catch((err) => {
        batch(() => {
          roll(input.sessionID, last)
          prompt.set(prev)
        })
        fail(err)
      })
      .finally(() => {
        setUi("reverting", false)
      })
  }

  const restore = (id: string) => {
    const sessionID = params.id
    if (!sessionID || ui.restoring || ui.reverting) return

    const next = userMessages().find((item) => item.id > id)
    const prev = prompt.current().slice()
    const last = info()?.revert

    batch(() => {
      setUi("restoring", id)
      setUi("reverting", true)
      roll(sessionID, next ? { messageID: next.id } : undefined)
      if (next) {
        prompt.set(draft(next.id))
        return
      }
      prompt.reset()
    })

    const task = !next
      ? halt(sessionID).then(() => sdk.client.project.session.unrevert({ sessionID, projectID: sdk.projectID }))
      : halt(sessionID).then(() =>
          sdk.client.project.session.revert({
            sessionID,
            messageID: next.id,
            projectID: sdk.projectID,
          }),
        )

    return task
      .then((result) => {
        if (result.data) merge(result.data)
      })
      .catch((err) => {
        batch(() => {
          roll(sessionID, last)
          prompt.set(prev)
        })
        fail(err)
      })
      .finally(() => {
        batch(() => {
          setUi("restoring", (value) => (value === id ? undefined : value))
          setUi("reverting", false)
        })
      })
  }

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    return userMessages()
      .filter((item) => item.id >= id)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  const actions = { fork, revert }

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return

    const item = queuedFollowups()[0]
    if (!item) return
    if (followup.sending[sessionID]) return
    if (followup.failed[sessionID] === item.id) return
    if (followup.paused[sessionID]) return
    if (composer.blocked()) return
    if (busy(sessionID)) return

    void sendFollowup(sessionID, item.id)
  })

  createResizeObserver(
    () => promptDock,
    ({ height }) => {
      const next = Math.ceil(height)

      if (next === dockHeight) return

      const el = scroller
      const delta = next - dockHeight
      const stick = el
        ? !autoScroll.userScrolled() || el.scrollHeight - el.clientHeight - el.scrollTop < 10 + Math.max(0, delta)
        : false

      dockHeight = next

      if (stick) autoScroll.forceScrollToBottom()

      if (el) scheduleScrollState(el)
      fill()
    },
  )

  const { clearMessageHash, scrollToMessage } = useSessionHashScroll({
    sessionKey,
    sessionID: () => params.id,
    messagesReady,
    visibleUserMessages,
    turnStart: historyWindow.turnStart,
    currentMessageId: () => store.messageId,
    pendingMessage: () => ui.pendingMessage,
    setPendingMessage: (value) => setUi("pendingMessage", value),
    setActiveMessage,
    setTurnStart: historyWindow.setTurnStart,
    autoScroll,
    scroller: () => scroller,
    anchor,
    scheduleScrollState,
    consumePendingMessage: layout.pendingMessage.consume,
  })

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown)
    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    review.cleanup()
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
  })

  return (
    <div class="relative bg-background-base size-full overflow-hidden flex flex-col">
      <SessionHeader />
      <div class="flex-1 min-h-0 flex flex-col md:flex-row">
        <Show when={!isDesktop() && !!params.id}>
          <Tabs value={store.mobileTab} class="h-auto">
            <Tabs.List>
              <Tabs.Trigger
                value="session"
                class="!w-1/2 !max-w-none"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "session")}
              >
                {language.t("session.tab.session")}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="changes"
                class="!w-1/2 !max-w-none !border-r-0"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "changes")}
              >
                {review.hasReview()
                  ? language.t("session.review.filesChanged", { count: review.reviewCount() })
                  : language.t("session.review.change.other")}
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </Show>

        {/* Session panel */}
        <div
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full bg-background-stronger flex-1 md:flex-none": true,
            "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
              !size.active() && !ui.reviewSnap,
          }}
          style={{
            width: sessionPanelWidth(),
          }}
        >
          <div class="flex-1 min-h-0 overflow-hidden">
            <Switch>
              <Match when={params.id}>
                <Show when={lastUserMessage()}>
                  <MessageTimeline
                    mobileChanges={mobileChanges()}
                    mobileFallback={review.reviewContent({
                      diffStyle: "unified",
                      classes: {
                        root: "pb-8",
                        header: "px-4",
                        container: "px-4",
                      },
                      loadingClass: "px-4 py-4 text-text-weak",
                      emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
                    })}
                    actions={actions}
                    scroll={ui.scroll}
                    onResumeScroll={resumeScroll}
                    setScrollRef={setScrollRef}
                    onScheduleScrollState={scheduleScrollState}
                    onAutoScrollHandleScroll={autoScroll.handleScroll}
                    onMarkScrollGesture={markScrollGesture}
                    hasScrollGesture={hasScrollGesture}
                    onUserScroll={markUserScroll}
                    onTurnBackfillScroll={historyWindow.onScrollerScroll}
                    onAutoScrollInteraction={autoScroll.handleInteraction}
                    centered={centered()}
                    setContentRef={(el) => {
                      content = el
                      autoScroll.contentRef(el)

                      const root = scroller
                      if (root) scheduleScrollState(root)
                    }}
                    turnStart={historyWindow.turnStart()}
                    historyMore={historyMore()}
                    historyLoading={historyLoading()}
                    onLoadEarlier={() => {
                      void historyWindow.loadAndReveal()
                    }}
                    renderedUserMessages={historyWindow.renderedUserMessages()}
                    anchor={anchor}
                    sessionID={params.id}
                    projectID={params.projectID}
                    sessionKey={sessionKey()}
                    onNavigateSession={(projectID, sessionID) => navigate(`/${projectID}/session/${sessionID}`)}
                    onNavigateSessionList={(projectID) => navigate(`/${projectID}/session`)}
                  />
                </Show>
              </Match>
              <Match when={true}>
                <NewSessionView worktree={newSessionWorktree()} />
              </Match>
            </Switch>
          </div>

          <SessionComposerRegion
            state={composer}
            ready={!store.deferRender && messagesReady()}
            centered={centered()}
            inputRef={(el) => {
              inputRef = el
            }}
            newSessionWorktree={newSessionWorktree()}
            onNewSessionWorktreeReset={() => setStore("newSessionWorktree", "main")}
            onSubmit={() => {
              comments.clear()
              resumeScroll()
            }}
            onResponseSubmit={resumeScroll}
            followup={
              params.id
                ? {
                    queue: queueEnabled,
                    items: followupDock(),
                    sending: sendingFollowup(),
                    edit: editingFollowup(),
                    onQueue: queueFollowup,
                    onAbort: () => {
                      const id = params.id
                      if (!id) return
                      setFollowup("paused", id, true)
                    },
                    onSend: (id) => {
                      if (params.id) void sendFollowup(params.id, id, { manual: true })
                    },
                    onEdit: editFollowup,
                    onEditLoaded: clearFollowupEdit,
                  }
                : undefined
            }
            revert={
              rolled().length > 0
                ? {
                    items: rolled(),
                    restoring: ui.restoring,
                    disabled: ui.reverting,
                    onRestore: restore,
                  }
                : undefined
            }
            setPromptDockRef={(el) => {
              promptDock = el
            }}
          />

          <Show when={desktopReviewOpen()}>
            <div onPointerDown={() => size.start()}>
              <ResizeHandle
                direction="horizontal"
                size={layout.session.width()}
                min={450}
                max={typeof window === "undefined" ? 1000 : Math.max(450, window.innerWidth - traceWidth() - 200)}
                onResize={(width) => {
                  size.touch()
                  layout.session.resize(width)
                }}
              />
            </div>
          </Show>
        </div>

        <SessionSidePanel
          reviewPanel={review.reviewPanel}
          activeDiff={review.tree.activeDiff}
          focusReviewDiff={review.focusReviewDiff}
          reviewSnap={ui.reviewSnap}
          size={size}
          traceWidth={traceWidth()}
        />

        <TracePanel size={size} />
      </div>

      <TerminalPanel />
    </div>
  )
}
