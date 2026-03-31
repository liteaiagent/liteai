import { Button } from "@liteai/ui/button"
import { useDialog } from "@liteai/ui/context/dialog"
import { DockShellForm, DockTray } from "@liteai/ui/dock-surface"
import { useFilteredList } from "@liteai/ui/hooks"
import { Icon } from "@liteai/ui/icon"
import { IconButton } from "@liteai/ui/icon-button"
import { ImagePreview } from "@liteai/ui/image-preview"
import { useSpring } from "@liteai/ui/motion-spring"
import { ProviderIcon } from "@liteai/ui/provider-icon"
import { Select } from "@liteai/ui/select"
import { Tooltip, TooltipKeybind } from "@liteai/ui/tooltip"
import { type Component, createEffect, createMemo, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useChatController, usePermissionController, useSelectionController } from "../controllers"
import { selectionFromLines } from "../shared/file-types"
import { useLanguage } from "../shared/language"
import { Persist, persisted } from "../shared/persist"
import { usePlatform } from "../shared/platform"
import {
  type ContentPart,
  type ContextItem,
  DEFAULT_PROMPT,
  type ImageAttachmentPart,
  type Prompt,
  usePrompt,
} from "../shared/prompt"
import { ChatModelSelector } from "./chat-model-selector"
import { addPartAtCursor } from "./prompt-input/add-part"
import { createPromptAttachments } from "./prompt-input/attachments"
import { PromptContextItems } from "./prompt-input/context-items"
import { PromptDragOverlay } from "./prompt-input/drag-overlay"
import { getCursorPosition, setCursorPosition } from "./prompt-input/editor-dom"
import { parseFromDOM, reconcile as reconcileEditor, renderEditor } from "./prompt-input/editor-reconciler"
import { ACCEPTED_FILE_TYPES } from "./prompt-input/files"
import {
  canNavigateHistoryAtCursor,
  navigatePromptHistory,
  type PromptHistoryComment,
  type PromptHistoryEntry,
  type PromptHistoryStoredEntry,
  prependHistoryEntry,
  promptLength,
} from "./prompt-input/history"
import { PromptImageAttachments } from "./prompt-input/image-attachments"
import { createImeHandler } from "./prompt-input/ime-handler"
import { promptPlaceholder } from "./prompt-input/placeholder"
import { type AtOption, PromptPopover, type SlashCommand } from "./prompt-input/slash-popover"

/**
 * Callback to handle prompt submission.
 */
export interface ChatPromptSubmitHandler {
  /** Submit the prompt for the given session (or create a new one) */
  submit: (event: Event) => Promise<void> | void
  /** Abort the current running request */
  abort: () => void
}

/**
 * A command option that can appear in the palette or be triggered by keybind.
 * This is the portable UI version — the web platform adapts its richer
 * CommandOption into this shape.
 */
export interface ChatCommandOption {
  id: string
  title: string
  description?: string
  category?: string
  keybind?: string
  slash?: string
  suggested?: boolean
  disabled?: boolean
  onSelect?: (source?: string) => void
  onHighlight?: () => (() => void) | undefined
}

/**
 * Command palette integration.
 * When omitted, no commands are registered and keybind tooltips show nothing.
 */
export interface ChatPromptCommands {
  register: {
    (cb: () => ChatCommandOption[]): void
    (key: string, cb: () => ChatCommandOption[]): void
  }
  keybind: (id: string) => string
  trigger: (id: string, source?: string) => void
  options: ChatCommandOption[]
}

/**
 * Inline comment focus target.
 */
export interface ChatCommentFocus {
  file: string
  id: string
}

/**
 * Comment system integration.
 * When omitted, comment history and navigation features are disabled.
 */
export interface ChatPromptCommentActions {
  all: () => Array<{
    file: string
    id: string
    comment: string
    time: number
    selection?: { start: number; end: number }
  }>
  replace: (
    items: Array<{
      id: string
      file: string
      comment: string
      time: number
      selection?: { start: number; end: number }
    }>,
  ) => void
  setActive: (focus: ChatCommentFocus | null) => void
  setFocus: (focus: ChatCommentFocus) => void
  focus: () => ChatCommentFocus | null
  active: () => ChatCommentFocus | null
  remove: (file: string, id: string) => void
}

interface ChatPromptInputProps {
  class?: string
  ref?: (el: HTMLDivElement) => void

  /** Session ID from route params */
  sessionID?: string

  /** Submit/abort handler — provided by the host (web/vscode) */
  handler: ChatPromptSubmitHandler

  /** Called after a successful submit */
  onSubmit?: () => void

  /** Search files/directories for @ mention popover. When omitted, only agents appear. */
  searchFiles?: (query: string) => Promise<string[]>

  /** Recent file paths for @ mention priority ordering. */
  recentFiles?: () => string[]

  /** Model selector action callbacks */
  onManageModels?: () => void
  onConnectProvider?: () => void

  /** Keybind display function */
  keybind?: (id: string) => string

  // ─── Phase 1c: Optional extension props ───

  /** Command palette integration. When omitted, no commands are registered. */
  commands?: ChatPromptCommands

  /** Comment system. When omitted, comment features are disabled. */
  commentActions?: ChatPromptCommentActions

  /** Callback when a context item's comment is opened. */
  onOpenComment?: (item: { path: string; commentID?: string; commentOrigin?: string }) => void

  /** New session worktree selection. */
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void

  /** Edit mode (re-edit a previous message). */
  edit?: { id: string; prompt: Prompt; context: ContextItem[] }
  onEditLoaded?: () => void

  /** Queue mode for follow-up prompts while session is busy. */
  shouldQueue?: () => boolean
  onQueue?: (draft: unknown) => void
  onAbort?: () => void
}

const EXAMPLES = [
  "prompt.example.1",
  "prompt.example.2",
  "prompt.example.3",
  "prompt.example.4",
  "prompt.example.5",
  "prompt.example.6",
  "prompt.example.7",
  "prompt.example.8",
  "prompt.example.9",
  "prompt.example.10",
  "prompt.example.11",
  "prompt.example.12",
  "prompt.example.13",
  "prompt.example.14",
  "prompt.example.15",
  "prompt.example.16",
  "prompt.example.17",
  "prompt.example.18",
  "prompt.example.19",
  "prompt.example.20",
  "prompt.example.21",
  "prompt.example.22",
  "prompt.example.23",
  "prompt.example.24",
  "prompt.example.25",
] as const

const NON_EMPTY_TEXT = /[^\s\u200B]/

const NO_OP_KEYBIND = () => ""

/**
 * Full-featured chat prompt input component.
 * Mirrors the web's PromptInput with controller interfaces for all data access.
 * Uses extracted Phase 2 modules (editor-reconciler, ime-handler, add-part).
 */
export const ChatPromptInput: Component<ChatPromptInputProps> = (props) => {
  const controller = useChatController()
  const selection = useSelectionController()
  const permission = usePermissionController()
  const prompt = usePrompt()
  const dialog = useDialog()
  const language = useLanguage()
  const _platform = usePlatform()
  let editorRef!: HTMLDivElement
  let fileInputRef: HTMLInputElement | undefined
  let scrollRef!: HTMLDivElement
  let slashPopoverRef!: HTMLDivElement

  const mirror = { input: false }
  const inset = 56
  const space = `${inset}px`

  const keybind = createMemo(() => props.commands?.keybind ?? NO_OP_KEYBIND)

  const scrollCursorIntoView = () => {
    const container = scrollRef
    const windowSelection = window.getSelection()
    if (!container || !windowSelection || windowSelection.rangeCount === 0) return

    const range = windowSelection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return

    const cursor = getCursorPosition(editorRef)
    const length = promptLength(prompt.current().filter((part) => part.type !== "image"))
    if (cursor >= length) {
      container.scrollTop = container.scrollHeight
      return
    }

    const rect = range.getClientRects().item(0) ?? range.getBoundingClientRect()
    if (!rect.height) return

    const containerRect = container.getBoundingClientRect()
    const top = rect.top - containerRect.top + container.scrollTop
    const bottom = rect.bottom - containerRect.top + container.scrollTop
    const padding = 12

    if (top < container.scrollTop + padding) {
      container.scrollTop = Math.max(0, top - padding)
      return
    }

    if (bottom > container.scrollTop + container.clientHeight - inset) {
      container.scrollTop = bottom - container.clientHeight + inset
    }
  }

  const queueScroll = (count = 2) => {
    requestAnimationFrame(() => {
      scrollCursorIntoView()
      if (count > 1) queueScroll(count - 1)
    })
  }

  const recent = createMemo(() => props.recentFiles?.() ?? [])

  const sessionID = () => props.sessionID

  // ─── Session Status ───

  const status = createMemo(() => {
    const id = sessionID()
    if (!id) return { type: "idle" as const }
    return controller.sessionStatus(id)
  })

  const working = createMemo(() => status().type !== "idle")

  const assistantRunning = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    return controller.messages(id).some((item) => item.role === "assistant" && typeof item.time.completed !== "number")
  })

  const _busy = createMemo(() => working() || assistantRunning())

  const imageAttachments = createMemo(() =>
    prompt.current().filter((part): part is ImageAttachmentPart => part.type === "image"),
  )

  // ─── Store ───

  const [store, setStore] = createStore<{
    popover: "at" | "slash" | null
    historyIndex: number
    savedPrompt: PromptHistoryEntry | null
    placeholder: number
    draggingType: "image" | "@mention" | null
    mode: "normal" | "shell"
    applyingHistory: boolean
  }>({
    popover: null,
    historyIndex: -1,
    savedPrompt: null as PromptHistoryEntry | null,
    placeholder: Math.floor(Math.random() * EXAMPLES.length),
    draggingType: null,
    mode: "normal",
    applyingHistory: false,
  })

  // ─── Spring Animation ───

  const buttonsSpring = useSpring(() => (store.mode === "normal" ? 1 : 0), { visualDuration: 0.2, bounce: 0 })
  const motion = (value: number) => ({
    opacity: value,
    transform: `scale(${0.95 + value * 0.05})`,
    filter: `blur(${(1 - value) * 2}px)`,
    "pointer-events": value > 0.5 ? ("auto" as const) : ("none" as const),
  })
  const buttons = createMemo(() => motion(buttonsSpring()))
  const shell = createMemo(() => motion(1 - buttonsSpring()))
  const control = createMemo(() => ({ height: "28px", ...buttons() }))

  // ─── Computed State ───

  const commentCount = createMemo(() => {
    if (store.mode === "shell") return 0
    return prompt.context.items().filter((item) => !!item.comment?.trim()).length
  })

  const contextItems = createMemo(() => {
    const items = prompt.context.items()
    if (store.mode !== "shell") return items
    return items.filter((item) => !item.comment?.trim())
  })

  const hasUserPrompt = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    const messages = controller.messages(id)
    return messages.some((m) => m.role === "user")
  })

  const suggest = createMemo(() => !hasUserPrompt())

  // ─── History ───

  const [history, setHistory] = persisted(
    Persist.global("prompt-history", ["prompt-history.v1"]),
    createStore<{ entries: PromptHistoryStoredEntry[] }>({ entries: [] }),
  )
  const [shellHistory, setShellHistory] = persisted(
    Persist.global("prompt-history-shell", ["prompt-history-shell.v1"]),
    createStore<{ entries: PromptHistoryStoredEntry[] }>({ entries: [] }),
  )

  const historyComments = (): PromptHistoryComment[] => {
    const commentActions = props.commentActions
    const byID = commentActions
      ? new Map(
          commentActions.all().map(
            (item) =>
              [
                `${item.file}\n${item.id}`,
                item as {
                  file: string
                  id: string
                  comment: string
                  time: number
                  selection?: { start: number; end: number }
                },
              ] as const,
          ),
        )
      : new Map<
          string,
          { file: string; id: string; comment: string; time: number; selection?: { start: number; end: number } }
        >()
    return prompt.context.items().flatMap((item) => {
      if (item.type !== "file") return []
      const comment = item.comment?.trim()
      if (!comment) return []

      const existing = item.commentID ? byID.get(`${item.path}\n${item.commentID}`) : undefined
      const existingSelection = existing?.selection
      const nextSelection =
        existingSelection ??
        (item.selection
          ? {
              start: item.selection.startLine,
              end: item.selection.endLine,
            }
          : undefined)
      if (!nextSelection) return []

      return [
        {
          id: item.commentID ?? item.key,
          path: item.path,
          selection: { ...nextSelection },
          comment,
          time: item.commentID ? (existing?.time ?? Date.now()) : Date.now(),
          origin: item.commentOrigin,
          preview: item.preview,
        } satisfies PromptHistoryComment,
      ]
    })
  }

  const applyHistoryComments = (items: PromptHistoryComment[]) => {
    props.commentActions?.replace(
      items.map((item) => ({
        id: item.id,
        file: item.path,
        selection: { ...item.selection },
        comment: item.comment,
        time: item.time,
      })),
    )
    prompt.context.replaceComments(
      items.map((item) => ({
        type: "file" as const,
        path: item.path,
        selection: selectionFromLines(item.selection),
        comment: item.comment,
        commentID: item.id,
        commentOrigin: item.origin,
        preview: item.preview,
      })),
    )
  }

  const applyHistoryPrompt = (entry: PromptHistoryEntry, position: "start" | "end") => {
    const p = entry.prompt
    const length = position === "start" ? 0 : promptLength(p)
    setStore("applyingHistory", true)
    applyHistoryComments(entry.comments)
    prompt.set(p, length)
    requestAnimationFrame(() => {
      editorRef.focus()
      setCursorPosition(editorRef, length)
      setStore("applyingHistory", false)
      queueScroll()
    })
  }

  // ─── Placeholder ───

  const placeholder = createMemo(() =>
    promptPlaceholder({
      mode: store.mode,
      commentCount: commentCount(),
      example: suggest() ? language.t(EXAMPLES[store.placeholder]) : "",
      suggest: suggest(),
      t: (key, params) => language.t(key as Parameters<typeof language.t>[0], params as never),
    }),
  )

  createEffect(() => {
    sessionID()
    if (sessionID()) return
    if (!suggest()) return
    const interval = setInterval(() => {
      setStore("placeholder", (prev) => (prev + 1) % EXAMPLES.length)
    }, 6500)
    onCleanup(() => clearInterval(interval))
  })

  // ─── IME Handler ───

  const ime = createImeHandler(() => {
    reconcile(prompt.current().filter((part) => part.type !== "image"))
  })

  // ─── Helper Functions ───

  const getCaretState = () => {
    const windowSelection = window.getSelection()
    const textLength = promptLength(prompt.current())
    if (!windowSelection || windowSelection.rangeCount === 0) {
      return { collapsed: false, cursorPosition: 0, textLength }
    }
    const anchorNode = windowSelection.anchorNode
    if (!anchorNode || !editorRef.contains(anchorNode)) {
      return { collapsed: false, cursorPosition: 0, textLength }
    }
    return {
      collapsed: windowSelection.isCollapsed,
      cursorPosition: getCursorPosition(editorRef),
      textLength,
    }
  }

  const pick = () => fileInputRef?.click()

  const setMode = (mode: "normal" | "shell") => {
    setStore("mode", mode)
    setStore("popover", null)
    requestAnimationFrame(() => editorRef?.focus())
  }

  const closePopover = () => setStore("popover", null)

  const resetHistoryNavigation = (force = false) => {
    if (!force && (store.historyIndex < 0 || store.applyingHistory)) return
    setStore("historyIndex", -1)
    setStore("savedPrompt", null)
  }

  const clearEditor = () => {
    editorRef.innerHTML = ""
  }

  const setEditorText = (text: string) => {
    clearEditor()
    editorRef.textContent = text
  }

  const focusEditorEnd = () => {
    requestAnimationFrame(() => {
      editorRef.focus()
      const range = document.createRange()
      const windowSelection = window.getSelection()
      range.selectNodeContents(editorRef)
      range.collapse(false)
      windowSelection?.removeAllRanges()
      windowSelection?.addRange(range)
    })
  }

  const _renderEditorWithCursor = (parts: Prompt) => {
    const windowSelection = window.getSelection()
    let cursor: number | null = null
    if (windowSelection && windowSelection.rangeCount > 0 && editorRef.contains(windowSelection.anchorNode)) {
      cursor = getCursorPosition(editorRef)
    }
    renderEditor(editorRef, parts)
    if (cursor !== null) setCursorPosition(editorRef, cursor)
  }

  // ─── Reconcile ───

  const reconcile = (input: Prompt) => {
    reconcileEditor(input, editorRef, mirror)
  }

  createEffect(
    on(
      () => prompt.current(),
      (parts) => {
        if (ime.composing()) return
        reconcile(parts.filter((part) => part.type !== "image"))
      },
    ),
  )

  // ─── Command Registration ───

  const shellModeKey = "mod+shift+x"
  const normalModeKey = "mod+shift+e"

  if (props.commands) {
    const commands = props.commands
    commands.register("prompt-input", () => [
      {
        id: "file.attach",
        title: language.t("prompt.action.attachFile"),
        category: language.t("command.category.file"),
        keybind: "mod+u",
        disabled: store.mode !== "normal",
        onSelect: pick,
      },
      {
        id: "prompt.mode.shell",
        title: language.t("command.prompt.mode.shell"),
        category: language.t("command.category.session"),
        keybind: shellModeKey,
        disabled: store.mode === "shell",
        onSelect: () => setMode("shell"),
      },
      {
        id: "prompt.mode.normal",
        title: language.t("command.prompt.mode.normal"),
        category: language.t("command.category.session"),
        keybind: normalModeKey,
        disabled: store.mode === "normal",
        onSelect: () => setMode("normal"),
      },
    ])
  }

  // ─── @ Mention popover (useFilteredList) ───

  const agentList = createMemo(() =>
    controller
      .agents()
      .filter((agent) => !agent.hidden && agent.mode !== "primary")
      .map((agent): AtOption => ({ type: "agent", name: agent.name, display: agent.name })),
  )

  const handleAtSelect = (option: AtOption | undefined) => {
    if (!option) return
    if (option.type === "agent") {
      addPart({ type: "agent", name: option.name, content: `@${option.name}`, start: 0, end: 0 })
    } else {
      addPart({ type: "file", path: option.path, content: `@${option.path}`, start: 0, end: 0 })
    }
  }

  const atKey = (x: AtOption | undefined) => {
    if (!x) return ""
    return x.type === "agent" ? `agent:${x.name}` : `file:${x.path}`
  }

  const {
    flat: atFlat,
    active: atActive,
    setActive: setAtActive,
    onInput: atOnInput,
    onKeyDown: atOnKeyDown,
  } = useFilteredList<AtOption>({
    items: async (query) => {
      const agents = agentList()
      const open = recent()
      const seen = new Set(open)
      const pinned: AtOption[] = open.map((path) => ({ type: "file", path, display: path, recent: true }))
      const paths = props.searchFiles ? await props.searchFiles(query) : []
      const fileOptions: AtOption[] = paths
        .filter((path: string) => !seen.has(path))
        .map((path: string) => ({ type: "file", path, display: path }))
      return [...agents, ...pinned, ...fileOptions]
    },
    key: atKey,
    filterKeys: ["display"],
    groupBy: (item) => {
      if (item.type === "agent") return "agent"
      if (item.recent) return "recent"
      return "file"
    },
    sortGroupsBy: (a, b) => {
      const rank = (category: string) => {
        if (category === "agent") return 0
        if (category === "recent") return 1
        return 2
      }
      return rank(a.category) - rank(b.category)
    },
    onSelect: handleAtSelect,
  })

  // ─── Slash command popover (useFilteredList) ───

  const slashCommands = createMemo<SlashCommand[]>(() => {
    const commandOptions = props.commands?.options ?? []
    const builtin = commandOptions
      .filter((opt) => !opt.disabled && !opt.id.startsWith("suggested.") && opt.slash)
      .map((opt) => ({
        id: opt.id,
        trigger: opt.slash ?? "",
        title: opt.title,
        description: opt.description,
        keybind: opt.keybind,
        type: "builtin" as const,
      }))

    const custom = controller.commands().map((cmd) => ({
      id: `custom.${cmd.name}`,
      trigger: cmd.name,
      title: cmd.name,
      description: cmd.description,
      type: "custom" as const,
      source: cmd.source,
    }))

    return [...custom, ...builtin]
  })

  const handleSlashSelect = (cmd: SlashCommand | undefined) => {
    if (!cmd) return
    closePopover()

    if (cmd.type === "custom") {
      const text = `/${cmd.trigger} `
      setEditorText(text)
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      focusEditorEnd()
      return
    }

    clearEditor()
    prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
    props.commands?.trigger(cmd.id, "slash")
  }

  const {
    flat: slashFlat,
    active: slashActive,
    setActive: setSlashActive,
    onInput: slashOnInput,
    onKeyDown: slashOnKeyDown,
  } = useFilteredList<SlashCommand>({
    items: slashCommands,
    key: (x) => x?.id,
    filterKeys: ["trigger", "title"],
    onSelect: handleSlashSelect,
  })

  // Auto-scroll active slash command into view
  createEffect(() => {
    const activeId = slashActive()
    if (!activeId || !slashPopoverRef) return

    requestAnimationFrame(() => {
      const element = slashPopoverRef.querySelector(`[data-slash-id="${activeId}"]`)
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  })

  const selectPopoverActive = () => {
    if (store.popover === "at") {
      const items = atFlat()
      if (items.length === 0) return
      const active = atActive()
      const item = items.find((entry) => atKey(entry) === active) ?? items[0]
      handleAtSelect(item)
      return
    }

    if (store.popover === "slash") {
      const items = slashFlat()
      if (items.length === 0) return
      const active = slashActive()
      const item = items.find((entry) => entry.id === active) ?? items[0]
      handleSlashSelect(item)
    }
  }

  // ─── addPart (delegates to extracted module) ───

  const addPart = (part: ContentPart) => {
    return addPartAtCursor(part, {
      editorRef,
      currentPrompt: () => prompt.current(),
      cursor: () => prompt.cursor(),
      handleInput,
      closePopover,
    })
  }

  // ─── Attachments ───

  const { addAttachment, removeAttachment, handlePaste } = createPromptAttachments({
    editor: () => editorRef,
    isDialogActive: () => !!dialog.active,
    setDraggingType: (type) => setStore("draggingType", type),
    focusEditor: () => {
      editorRef.focus()
      setCursorPosition(editorRef, promptLength(prompt.current()))
    },
    addPart,
  })

  // ─── Handle Input ───

  const handleInput = () => {
    const rawParts = parseFromDOM(editorRef)
    const images = imageAttachments()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText =
      rawParts.length === 1 && rawParts[0]?.type === "text"
        ? rawParts[0].content
        : rawParts.map((p) => ("content" in p ? p.content : "")).join("")
    const hasNonText = rawParts.some((part) => part.type !== "text")
    const shouldReset = !NON_EMPTY_TEXT.test(rawText) && !hasNonText && images.length === 0

    if (shouldReset) {
      closePopover()
      resetHistoryNavigation()
      if (prompt.dirty()) {
        mirror.input = true
        prompt.set(DEFAULT_PROMPT, 0)
      }
      queueScroll()
      return
    }

    const shellMode = store.mode === "shell"

    if (!shellMode) {
      const atMatch = rawText.substring(0, cursorPosition).match(/@(\S*)$/)
      const slashMatch = rawText.match(/^\/(\S*)$/)

      if (atMatch) {
        atOnInput(atMatch[1])
        setStore("popover", "at")
      } else if (slashMatch) {
        slashOnInput(slashMatch[1])
        setStore("popover", "slash")
      } else {
        closePopover()
      }
    } else {
      closePopover()
    }

    resetHistoryNavigation()

    mirror.input = true
    prompt.set([...rawParts, ...images], cursorPosition)
    queueScroll()
  }

  // ─── History Navigation ───

  const addToHistory = (p: Prompt, mode: "normal" | "shell") => {
    const currentHistory = mode === "shell" ? shellHistory : history
    const setCurrentHistory = mode === "shell" ? setShellHistory : setHistory
    const next = prependHistoryEntry(currentHistory.entries, p, mode === "shell" ? [] : historyComments())
    if (next === currentHistory.entries) return
    setCurrentHistory("entries", next)
  }

  const navigateHistory = (direction: "up" | "down") => {
    const result = navigatePromptHistory({
      direction,
      entries: store.mode === "shell" ? shellHistory.entries : history.entries,
      historyIndex: store.historyIndex,
      currentPrompt: prompt.current(),
      currentComments: historyComments(),
      savedPrompt: store.savedPrompt,
    })
    if (!result.handled) return false
    setStore("historyIndex", result.historyIndex)
    setStore("savedPrompt", result.savedPrompt)
    applyHistoryPrompt(result.entry, result.cursor)
    return true
  }

  // ─── Edit Mode ───

  createEffect(
    on(
      () => props.edit?.id,
      (id) => {
        const edit = props.edit
        if (!id || !edit) return

        for (const item of prompt.context.items()) {
          prompt.context.remove(item.key)
        }

        for (const item of edit.context) {
          prompt.context.add({
            type: item.type,
            path: item.path,
            selection: item.selection,
            comment: item.comment,
            commentID: item.commentID,
            commentOrigin: item.commentOrigin,
            preview: item.preview,
          })
        }

        setStore("mode", "normal")
        setStore("popover", null)
        setStore("historyIndex", -1)
        setStore("savedPrompt", null)
        prompt.set(edit.prompt, promptLength(edit.prompt))
        requestAnimationFrame(() => {
          editorRef.focus()
          setCursorPosition(editorRef, promptLength(edit.prompt))
          queueScroll()
        })
        props.onEditLoaded?.()
      },
      { defer: true },
    ),
  )

  // ─── Permission (auto-accept / YOLO) ───

  const accepting = createMemo(() => permission.isAutoAccepting(sessionID()))
  const acceptLabel = createMemo(() =>
    language.t(accepting() ? "command.permissions.autoaccept.disable" : "command.permissions.autoaccept.enable"),
  )
  const toggleAccept = () => {
    permission.toggle(sessionID())
  }

  // ─── Submit ───

  const handleSubmit = (event: Event) => {
    event.preventDefault()

    if (working()) {
      props.handler.abort()
      props.onAbort?.()
      return
    }

    if (!prompt.dirty() && commentCount() === 0) return

    // Save to history + reset
    addToHistory(prompt.current(), store.mode)
    resetHistoryNavigation(true)

    void props.handler.submit(event)

    prompt.reset()
    clearEditor()
    setStore("mode", "normal")
    setStore("popover", null)
    props.onSubmit?.()
  }

  const abort = () => {
    props.handler.abort()
    props.onAbort?.()
  }

  // ─── Handle Blur ───

  const handleBlur = () => {
    closePopover()
    // Reset IME on blur to prevent stale composition state
  }

  // ─── Keydown Handler ───

  const handleKeyDown = (event: KeyboardEvent) => {
    // Ctrl+U: attach file
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "u") {
      event.preventDefault()
      if (store.mode !== "normal") return
      pick()
      return
    }

    // Backspace: handle ZWS edge case
    if (event.key === "Backspace") {
      const windowSelection = window.getSelection()
      if (windowSelection?.isCollapsed) {
        const node = windowSelection.anchorNode
        const offset = windowSelection.anchorOffset
        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? ""
          if (/^\u200B+$/.test(text) && offset > 0) {
            const range = document.createRange()
            range.setStart(node, 0)
            range.collapse(true)
            windowSelection.removeAllRanges()
            windowSelection.addRange(range)
          }
        }
      }
    }

    // ! at position 0: enter shell mode
    if (event.key === "!" && store.mode === "normal") {
      const cursorPosition = getCursorPosition(editorRef)
      if (cursorPosition === 0) {
        setStore("mode", "shell")
        setStore("popover", null)
        event.preventDefault()
        return
      }
    }

    // Escape cascading: popover → shell → abort → blur
    if (event.key === "Escape") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (store.mode === "shell") {
        setStore("mode", "normal")
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (working()) {
        abort()
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    // Shell mode: backspace-to-exit when empty
    if (store.mode === "shell") {
      const { collapsed, cursorPosition, textLength } = getCaretState()
      if (event.key === "Backspace" && collapsed && cursorPosition === 0 && textLength === 0) {
        setStore("mode", "normal")
        event.preventDefault()
        return
      }
    }

    // Shift+Enter: insert newline (BEFORE IME check)
    if (event.key === "Enter" && event.shiftKey) {
      addPart({ type: "text", content: "\n", start: 0, end: 0 })
      event.preventDefault()
      return
    }

    // Skip Enter during IME composition
    if (event.key === "Enter" && ime.isImeComposing(event)) {
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    // Popover navigation
    if (store.popover) {
      if (event.key === "Tab") {
        selectPopoverActive()
        event.preventDefault()
        return
      }
      const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
      const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
      if (nav || ctrlNav) {
        if (store.popover === "at") {
          atOnKeyDown(event)
          event.preventDefault()
          return
        }
        if (store.popover === "slash") {
          slashOnKeyDown(event)
        }
        event.preventDefault()
        return
      }
    }

    // Ctrl+G: abort
    if (ctrl && event.code === "KeyG") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        return
      }
      if (working()) {
        abort()
        event.preventDefault()
      }
      return
    }

    // History navigation
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const { collapsed } = getCaretState()
      if (!collapsed) return

      const cursorPosition = getCursorPosition(editorRef)
      const textContent = prompt
        .current()
        .map((part) => ("content" in part ? part.content : ""))
        .join("")
      const direction = event.key === "ArrowUp" ? "up" : "down"
      if (!canNavigateHistoryAtCursor(direction, textContent, cursorPosition, store.historyIndex >= 0)) return
      if (navigateHistory(direction)) {
        event.preventDefault()
      }
      return
    }

    // Enter: submit
    if (event.key === "Enter" && !event.shiftKey) {
      handleSubmit(event)
    }
  }

  // ─── Agent / Model / Variant (controller-based) ───

  const agentNames = createMemo(() => selection.agent.list().map((agent) => agent.name))
  const variants = createMemo(() => ["default", ...selection.model.variant.list()])

  // ─── Render ───

  return (
    <div class="relative size-full _max-h-[320px] flex flex-col gap-0">
      <PromptPopover
        popover={store.popover}
        setSlashPopoverRef={(el) => (slashPopoverRef = el)}
        atFlat={atFlat()}
        atActive={atActive() ?? undefined}
        atKey={atKey}
        setAtActive={setAtActive}
        onAtSelect={handleAtSelect}
        slashFlat={slashFlat()}
        slashActive={slashActive() ?? undefined}
        setSlashActive={setSlashActive}
        onSlashSelect={handleSlashSelect}
        commandKeybind={keybind()}
        t={(key) => language.t(key as Parameters<typeof language.t>[0])}
      />
      <DockShellForm
        onSubmit={handleSubmit}
        classList={{
          "group/prompt-input": true,
          "focus-within:shadow-xs-border": true,
          "border-icon-info-active border-dashed": store.draggingType !== null,
          [props.class ?? ""]: !!props.class,
        }}
      >
        <PromptDragOverlay
          type={store.draggingType}
          label={language.t(store.draggingType === "@mention" ? "prompt.dropzone.file.label" : "prompt.dropzone.label")}
        />
        <PromptContextItems
          items={contextItems()}
          active={(item) => {
            const active = props.commentActions?.active()
            return !!item.commentID && item.commentID === active?.id && item.path === active?.file
          }}
          openComment={(item) => {
            props.onOpenComment?.({
              path: item.path,
              commentID: item.commentID,
              commentOrigin: item.commentOrigin,
            })
          }}
          remove={(item) => {
            if (item.commentID) props.commentActions?.remove(item.path, item.commentID)
            prompt.context.remove(item.key)
          }}
          t={(key) => language.t(key as Parameters<typeof language.t>[0])}
        />
        <PromptImageAttachments
          attachments={imageAttachments()}
          onOpen={(attachment) =>
            dialog.show(() => <ImagePreview src={attachment.dataUrl} alt={attachment.filename} />)
          }
          onRemove={removeAttachment}
          removeLabel={language.t("prompt.attachment.remove")}
        />
        <div
          class="relative"
          onPointerDown={(e) => {
            const target = e.target
            if (!(target instanceof HTMLElement)) return
            if (
              target.closest(
                '[data-action="prompt-attach"], [data-action="prompt-submit"], [data-action="prompt-permissions"]',
              )
            ) {
              return
            }
            editorRef?.focus()
          }}
        >
          <div
            class="relative max-h-[240px] overflow-y-auto no-scrollbar"
            ref={(el) => (scrollRef = el)}
            style={{ "scroll-padding-bottom": space }}
          >
            {/* biome-ignore lint/a11y/useSemanticElements: contenteditable cannot be input/textarea */}
            <div
              data-component="prompt-input"
              ref={(el) => {
                editorRef = el
                props.ref?.(el)
              }}
              role="textbox"
              aria-multiline="true"
              tabIndex={0}
              aria-label={placeholder()}
              contenteditable="true"
              autocapitalize={store.mode === "normal" ? "sentences" : "off"}
              autocorrect={store.mode === "normal" ? "on" : "off"}
              spellcheck={store.mode === "normal"}
              onInput={handleInput}
              onPaste={handlePaste}
              onCompositionStart={ime.handleCompositionStart}
              onCompositionEnd={ime.handleCompositionEnd}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              classList={{
                "select-text": true,
                "w-full pl-3 pr-2 pt-2 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
                "[&_[data-type=file]]:text-syntax-property": true,
                "[&_[data-type=agent]]:text-syntax-type": true,
                "font-mono!": store.mode === "shell",
              }}
              style={{ "padding-bottom": space }}
            />
            <Show when={!prompt.dirty()}>
              <div
                class="absolute top-0 inset-x-0 pl-3 pr-2 pt-2 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate"
                classList={{ "font-mono!": store.mode === "shell" }}
                style={{ "padding-bottom": space }}
              >
                {placeholder()}
              </div>
            </Show>
          </div>

          {/* Gradient overlay */}
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 bottom-0"
            style={{
              height: space,
              background:
                "linear-gradient(to top, var(--surface-raised-stronger-non-alpha) calc(100% - 20px), transparent)",
            }}
          />

          {/* Submit / Stop button (bottom right) */}
          <div class="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES.join(",")}
              class="hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                if (file) void addAttachment(file)
                e.currentTarget.value = ""
              }}
            />

            <div class="flex items-center gap-1 pointer-events-auto">
              <Tooltip
                placement="top"
                inactive={!prompt.dirty() && !working()}
                value={
                  <Switch>
                    <Match when={working()}>
                      <div class="flex items-center gap-2">
                        <span>{language.t("prompt.action.stop")}</span>
                        <span class="text-icon-base text-12-medium text-[10px]!">{language.t("common.key.esc")}</span>
                      </div>
                    </Match>
                    <Match when={true}>
                      <div class="flex items-center gap-2">
                        <span>{language.t("prompt.action.send")}</span>
                        <Icon name="enter" size="small" class="text-icon-base" />
                      </div>
                    </Match>
                  </Switch>
                }
              >
                <IconButton
                  data-action="prompt-submit"
                  type="submit"
                  disabled={store.mode !== "normal" || (!prompt.dirty() && !working() && commentCount() === 0)}
                  tabIndex={store.mode === "normal" ? undefined : -1}
                  icon={working() ? "stop" : "arrow-up"}
                  variant="primary"
                  class="size-8"
                  style={buttons()}
                  aria-label={working() ? language.t("prompt.action.stop") : language.t("prompt.action.send")}
                />
              </Tooltip>
            </div>
          </div>

          {/* Attach button (bottom left) */}
          <div class="pointer-events-none absolute bottom-2 left-2">
            <div
              aria-hidden={store.mode !== "normal"}
              class="pointer-events-auto"
              style={{
                "pointer-events": buttonsSpring() > 0.5 ? "auto" : "none",
              }}
            >
              <TooltipKeybind
                placement="top"
                title={language.t("prompt.action.attachFile")}
                keybind={keybind()("file.attach")}
              >
                <Button
                  data-action="prompt-attach"
                  type="button"
                  variant="ghost"
                  class="size-8 p-0"
                  style={buttons()}
                  onClick={pick}
                  disabled={store.mode !== "normal"}
                  tabIndex={store.mode === "normal" ? undefined : -1}
                  aria-label={language.t("prompt.action.attachFile")}
                >
                  <Icon name="plus" class="size-4.5" />
                </Button>
              </TooltipKeybind>
            </div>
          </div>
        </div>
      </DockShellForm>
      <Show when={store.mode === "normal" || store.mode === "shell"}>
        <DockTray attach="top">
          <div class="px-1.75 pt-5.5 pb-2 flex items-center gap-2 min-w-0">
            <div class="flex items-center gap-1.5 min-w-0 flex-1 relative">
              {/* Shell mode label */}
              <div
                class="h-7 flex items-center gap-1.5 max-w-[160px] min-w-0 absolute inset-y-0 left-0"
                style={{
                  padding: "0 4px 0 8px",
                  ...shell(),
                }}
              >
                <span class="truncate text-13-medium text-text-strong">{language.t("prompt.mode.shell")}</span>
                <div class="size-4 shrink-0" />
              </div>
              <div class="flex items-center gap-1.5 min-w-0 flex-1">
                {/* Agent selector */}
                <div data-component="prompt-agent-control">
                  <TooltipKeybind
                    placement="top"
                    gutter={4}
                    title={language.t("command.agent.cycle")}
                    keybind={keybind()("agent.cycle")}
                  >
                    <Select
                      size="normal"
                      options={agentNames()}
                      current={selection.agent.current()?.name ?? ""}
                      onSelect={selection.agent.set}
                      class="capitalize max-w-[160px] text-text-base"
                      valueClass="truncate text-13-regular text-text-base"
                      triggerStyle={control()}
                      triggerProps={{ "data-action": "prompt-agent" }}
                      variant="ghost"
                    />
                  </TooltipKeybind>
                </div>

                {/* Model selector */}
                <div data-component="prompt-model-control">
                  <TooltipKeybind
                    placement="top"
                    gutter={4}
                    title={language.t("command.model.choose")}
                    keybind={keybind()("model.choose")}
                  >
                    <ChatModelSelector
                      onManageModels={props.onManageModels}
                      onConnectProvider={props.onConnectProvider}
                    >
                      <Button
                        data-action="prompt-model"
                        as="div"
                        variant="ghost"
                        size="normal"
                        class="min-w-0 max-w-[320px] text-13-regular text-text-base group"
                        style={control()}
                      >
                        <Show when={selection.model.current()?.provider?.id}>
                          <ProviderIcon
                            id={selection.model.current()?.provider.id ?? ""}
                            class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                            style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                          />
                        </Show>
                        <span class="truncate">
                          {selection.model.current()?.name ?? language.t("dialog.model.select.title")}
                        </span>
                        <Icon name="chevron-down" size="small" class="shrink-0" />
                      </Button>
                    </ChatModelSelector>
                  </TooltipKeybind>
                </div>

                {/* Variant selector */}
                <div data-component="prompt-variant-control">
                  <TooltipKeybind
                    placement="top"
                    gutter={4}
                    title={language.t("command.model.variant.cycle")}
                    keybind={keybind()("model.variant.cycle")}
                  >
                    <Select
                      size="normal"
                      options={variants()}
                      current={selection.model.variant.current() ?? "default"}
                      label={(x) => (x === "default" ? language.t("common.default") : x)}
                      onSelect={(x) => selection.model.variant.set(x === "default" ? undefined : x)}
                      class="capitalize max-w-[160px] text-text-base"
                      valueClass="truncate text-13-regular text-text-base"
                      triggerStyle={control()}
                      triggerProps={{ "data-action": "prompt-model-variant" }}
                      variant="ghost"
                    />
                  </TooltipKeybind>
                </div>

                {/* Auto-accept / YOLO button */}
                <TooltipKeybind
                  placement="top"
                  gutter={8}
                  title={acceptLabel()}
                  keybind={keybind()("permissions.autoaccept")}
                >
                  <Button
                    data-action="prompt-permissions"
                    variant="ghost"
                    onClick={toggleAccept}
                    classList={{
                      "h-7 w-7 p-0 shrink-0 flex items-center justify-center": true,
                      "text-text-base": !accepting(),
                      "hover:bg-surface-success-base": accepting(),
                    }}
                    style={control()}
                    aria-label={acceptLabel()}
                    aria-pressed={accepting()}
                  >
                    <Icon name="shield" size="small" classList={{ "text-icon-success-base": accepting() }} />
                  </Button>
                </TooltipKeybind>
              </div>
            </div>
          </div>
        </DockTray>
      </Show>
    </div>
  )
}
