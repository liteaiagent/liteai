import type { UserMessage } from "@liteai/sdk"
import { createAutoScroll } from "@liteai/ui/hooks"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { type Component, createEffect, createMemo, type JSX, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useChatController } from "../controllers"
import { useLanguage } from "../shared/language"
import { usePaneRoute } from "../shared/pane-route"
import { type ContextItem, type Prompt, usePrompt } from "../shared/prompt"
import { ChatNewSession } from "./chat-new-session"
import {
  type ChatPromptCommands,
  type ChatPromptCommentActions,
  ChatPromptInput,
  type ChatPromptSubmitHandler,
} from "./chat-prompt-input"
import { createSessionHistoryWindow, emptyUserMessages } from "./history-window"
import { MessageTimeline } from "./message-timeline"
import { same } from "./same"

interface ChatPaneProps {
  /** Submit/abort handler — provided by the host (web/vscode) */
  handler: ChatPromptSubmitHandler

  /** Ref to the editor element */
  inputRef?: (el: HTMLDivElement) => void

  /** Called after a successful prompt submit */
  onSubmit?: () => void

  /** Search files for @ mention */
  searchFiles?: (query: string) => Promise<string[]>

  /** Recent file paths */
  recentFiles?: () => string[]

  /** Navigate to a session */
  onNavigateSession?: (projectID: string, sessionID: string) => void

  /** Navigate to session list */
  onNavigateSessionList?: (projectID: string) => void

  /** Model management callbacks (web shows dialogs, vscode can show commands) */
  onManageModels?: () => void
  onConnectProvider?: () => void

  /** Worktree for new session view */
  worktree?: string

  /** Keybind display function */
  keybind?: (id: string) => string

  /** Session ID override */
  sessionID?: string

  /** Project ID override */
  projectID?: string

  /** Optional custom message actions (fork, revert) */
  actions?: {
    fork?: (input: { sessionID: string; messageID: string }) => void
    revert?: (input: { sessionID: string; messageID: string }) => void
  }

  /** Extra JSX rendered below the prompt input */
  footer?: JSX.Element

  /** Extra JSX rendered inside the input dock container, above the prompt input */
  promptDocks?: JSX.Element

  // ─── Advanced prompt input props (proxied through to ChatPromptInput) ───

  /**
   * Command palette integration.
   * When omitted, no commands are registered and keybind tooltips show empty strings.
   */
  commands?: ChatPromptCommands

  /**
   * Comment system integration.
   * When omitted, comment history/navigation features are disabled.
   */
  commentActions?: ChatPromptCommentActions

  /**
   * Called when a context item's inline comment is opened from the tray.
   */
  onOpenComment?: (item: { path: string; commentID?: string; commentOrigin?: string }) => void

  /**
   * Returns true when the prompt should be queued rather than submitted directly
   * (e.g. the session is busy and the host wants to buffer the next prompt).
   */
  shouldQueue?: () => boolean

  /**
   * Called with the draft payload when shouldQueue() returns true and the user
   * submits. The host is responsible for persisting and re-submitting later.
   */
  onQueue?: (draft: unknown) => void

  /**
   * Called when the user requests an abort (e.g. Ctrl+G, Stop button).
   * Defaults to handler.abort() when omitted.
   */
  onAbort?: () => void

  /**
   * Pre-populates the editor with an existing message for editing.
   */
  edit?: { id: string; prompt: Prompt; context: ContextItem[] }
  onEditLoaded?: () => void
}

/**
 * Top-level chat pane component.
 * Composes MessageTimeline + ChatPromptInput into a full chat experience.
 * Use PaneProviders to wrap this component with the required contexts.
 */
export const ChatPane: Component<ChatPaneProps> = (props) => {
  const route = usePaneRoute()
  const controller = useChatController()
  const _prompt = usePrompt()
  const _language = useLanguage()

  const sessionID = createMemo(() => props.sessionID ?? route()?.sessionID)
  const projectID = createMemo(() => props.projectID ?? route()?.projectID)

  const messages = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return controller.messages(id)
  })

  const messagesReady = createMemo(() => {
    const id = sessionID()
    if (!id) return true
    return controller.messagesReady(id)
  })

  const historyMore = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    return controller.session.history.more(id)
  })

  const historyLoading = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    return controller.session.history.loading(id)
  })

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )

  const info = createMemo(() => {
    const id = sessionID()
    return id ? controller.session.get(id) : undefined
  })

  const revertMessageID = createMemo(() => info()?.revert?.messageID)

  const visibleUserMessages = createMemo(
    () => {
      const revert = revertMessageID()
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    { equals: same },
  )

  const lastUserMessage = createMemo(() => visibleUserMessages().at(-1))

  // ─── Scroll ───

  const autoScroll = createAutoScroll({
    working: () => true,
    overflowAnchor: "dynamic",
  })

  let scroller: HTMLElement | undefined
  let content: HTMLElement | undefined
  let promptDock: HTMLDivElement | undefined
  let dockHeight = 0

  const [ui, setUi] = createStore({
    scroll: { overflow: false, bottom: true },
  })

  const updateScrollState = (el: HTMLElement) => {
    const max = el.scrollHeight - el.clientHeight
    const overflow = max > 1
    const bottom = !overflow || el.scrollTop >= max - 2
    if (ui.scroll.overflow === overflow && ui.scroll.bottom === bottom) return
    setUi("scroll", { overflow, bottom })
  }

  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLElement | undefined

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
    autoScroll.forceScrollToBottom()
    const el = scroller
    if (el) scheduleScrollState(el)
  }

  const setScrollRef = (el: HTMLElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
    if (!el) return
    scheduleScrollState(el)
  }

  // ─── History window ───

  const historyWindow = createSessionHistoryWindow({
    sessionID: () => sessionID(),
    messagesReady,
    loaded: () => messages().length,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (id) => controller.session.history.loadMore(id),
    userScrolled: autoScroll.userScrolled,
    scroller: () => scroller,
  })

  // ─── Sync session data ───

  createEffect(
    on(
      () => sessionID(),
      (id) => {
        if (!id) return
        void controller.session.sync(id)
      },
    ),
  )

  const anchor = (id: string) => `message-${id}`

  // ─── Resize handling ───

  createResizeObserver(
    () => content,
    () => {
      const el = scroller
      if (el) scheduleScrollState(el)
    },
  )

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
    },
  )

  // ─── Cleanup ───

  onCleanup(() => {
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
  })

  // ─── Render ───

  return (
    <div class="relative bg-background-base size-full overflow-hidden flex flex-col">
      <div class="flex-1 min-h-0 flex flex-col">
        <div class="flex-1 min-h-0 overflow-hidden">
          <Switch>
            <Match when={sessionID()}>
              <Show when={lastUserMessage()}>
                <MessageTimeline
                  mobileChanges={false}
                  mobileFallback={<div />}
                  actions={props.actions ?? {}}
                  scroll={ui.scroll}
                  onResumeScroll={resumeScroll}
                  setScrollRef={setScrollRef}
                  onScheduleScrollState={scheduleScrollState}
                  onAutoScrollHandleScroll={autoScroll.handleScroll}
                  onMarkScrollGesture={() => {}}
                  hasScrollGesture={() => false}
                  onUserScroll={() => {}}
                  onTurnBackfillScroll={historyWindow.onScrollerScroll}
                  onAutoScrollInteraction={autoScroll.handleInteraction}
                  centered={true}
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
                  sessionID={sessionID() || ""}
                  projectID={projectID()}
                  sessionKey={`${projectID() ?? ""}:${sessionID() ?? ""}`}
                  onNavigateSession={props.onNavigateSession}
                  onNavigateSessionList={props.onNavigateSessionList}
                />
              </Show>
            </Match>
            <Match when={true}>
              <ChatNewSession worktree={props.worktree} />
            </Match>
          </Switch>
        </div>

        {/* Prompt input dock */}
        <div
          ref={(el) => {
            promptDock = el
          }}
          class="mt-auto px-3 pb-3"
        >
          {props.promptDocks}
          <ChatPromptInput
            ref={props.inputRef}
            sessionID={sessionID()}
            handler={props.handler}
            onSubmit={() => {
              resumeScroll()
              props.onSubmit?.()
            }}
            searchFiles={props.searchFiles}
            recentFiles={props.recentFiles}
            onManageModels={props.onManageModels}
            onConnectProvider={props.onConnectProvider}
            keybind={props.keybind}
            commands={props.commands}
            commentActions={props.commentActions}
            onOpenComment={props.onOpenComment}
            shouldQueue={props.shouldQueue}
            onQueue={props.onQueue}
            onAbort={props.onAbort}
            edit={props.edit}
            onEditLoaded={props.onEditLoaded}
          />
        </div>

        {props.footer}
      </div>
    </div>
  )
}
