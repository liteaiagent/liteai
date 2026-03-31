import { useDialog } from "@liteai/ui/context/dialog"
import { DockShellForm, DockTray } from "@liteai/ui/dock-surface"
import { IconButton } from "@liteai/ui/icon-button"
import { ImagePreview } from "@liteai/ui/image-preview"
import { ProviderIcon } from "@liteai/ui/provider-icon"
import { Select } from "@liteai/ui/select"
import { Tooltip } from "@liteai/ui/tooltip"
import { type Component, createEffect, createMemo, createSignal, Match, on, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useChatController, useSelectionController } from "../controllers"
import { useLanguage } from "../shared/language"
import { Persist, persisted } from "../shared/persist"
import { usePlatform } from "../shared/platform"
import {
  type AgentPart,
  type ContentPart,
  type ContextItem,
  type FileAttachmentPart,
  type ImageAttachmentPart,
  type Prompt,
  usePrompt,
} from "../shared/prompt"
import { ChatModelSelector } from "./chat-model-selector"
import { createPromptAttachments } from "./prompt-input/attachments"
import { PromptContextItems } from "./prompt-input/context-items"
import { PromptDragOverlay } from "./prompt-input/drag-overlay"
import { createTextFragment, getCursorPosition, setCursorPosition } from "./prompt-input/editor-dom"
import { ACCEPTED_FILE_TYPES } from "./prompt-input/files"
import {
  canNavigateHistoryAtCursor,
  navigatePromptHistory,
  type PromptHistoryComment,
  type PromptHistoryStoredEntry,
  prependHistoryEntry,
  promptLength,
} from "./prompt-input/history"
import { PromptImageAttachments } from "./prompt-input/image-attachments"
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

/**
 * Portable chat prompt input component for use in ChatPane.
 * This is a streamlined version of the web's PromptInput,
 * without command palette, comment system, or worktree management.
 */
export const ChatPromptInput: Component<ChatPromptInputProps> = (props) => {
  const controller = useChatController()
  const selection = useSelectionController()
  const prompt = usePrompt()
  const dialog = useDialog()
  const language = useLanguage()
  const _platform = usePlatform()
  let editorRef!: HTMLDivElement
  let fileInputRef: HTMLInputElement | undefined
  let scrollRef!: HTMLDivElement
  let _slashPopoverRef!: HTMLDivElement

  const mirror = { input: false }
  const inset = 56
  const space = `${inset}px`
  const keybind = createMemo(() => props.keybind ?? (() => ""))

  const _scrollCursorIntoView = () => {
    const container = scrollRef
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
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
    } else if (bottom > container.scrollTop + container.clientHeight - padding) {
      container.scrollTop = bottom - container.clientHeight + padding
    }
  }

  // ─── Prompt State ───

  const images = createMemo(() => prompt.current().filter((part): part is ImageAttachmentPart => part.type === "image"))
  const hasImages = createMemo(() => images().length > 0)

  const _textLength = createMemo(() => promptLength(prompt.current().filter((part) => part.type !== "image")))

  const promptText = createMemo(() =>
    prompt
      .current()
      .filter((p) => p.type !== "image")
      .map((part) => ("content" in part ? part.content : ""))
      .join(""),
  )

  const hasContent = createMemo(() => NON_EMPTY_TEXT.test(promptText()) || hasImages())

  // ─── Session Status ───

  const sessionStatus = createMemo(() => {
    const id = props.sessionID
    if (!id) return { type: "idle" as const }
    return controller.sessionStatus(id)
  })

  const working = createMemo(() => sessionStatus().type !== "idle")

  const assistantRunning = createMemo(() => {
    const id = props.sessionID
    if (!id) return false
    return controller.messages(id).some((item) => item.role === "assistant" && typeof item.time.completed !== "number")
  })

  const busy = createMemo(() => working() || assistantRunning())

  // ─── Agent/Model ───

  const agent = createMemo(() => selection.agent.current())
  const agentName = createMemo(() => agent()?.name)
  const model = createMemo(() => selection.model.current())

  // ─── History ───

  const [history, setHistory] = persisted(
    Persist.workspace(controller.directory(), "prompt-history"),
    createStore<{ entries: PromptHistoryStoredEntry[] }>({ entries: [] }),
  )

  const [historyIndex, setHistoryIndex] = createSignal(-1)
  const [savedPrompt, setSavedPrompt] = createSignal<{ prompt: Prompt; comments: PromptHistoryComment[] } | null>(null)

  // ─── @ Mention ───

  const [store, setStore] = createStore<{
    popover: "at" | "slash" | null
    atQuery: string
    slashQuery: string
    atActive?: string
    slashActive?: string
    draggingType: "image" | "@mention" | null
  }>({
    popover: null,
    atQuery: "",
    slashQuery: "",
    atActive: undefined,
    slashActive: undefined,
    draggingType: null,
  })

  // @ mention: agents + files
  const agents = createMemo(() =>
    controller
      .agents()
      .filter((item) => item.mode !== "subagent" && !item.hidden)
      .map((item) => ({
        type: "agent" as const,
        name: item.name,
        display: `@${item.name}`,
      })),
  )

  const [atFiles, setAtFiles] = createSignal<AtOption[]>([])

  createEffect(
    on(
      () => store.atQuery,
      (query) => {
        if (!query || !props.searchFiles) {
          setAtFiles([])
          return
        }
        void props.searchFiles(query).then((results) => {
          setAtFiles(
            results.map((path) => ({
              type: "file" as const,
              path,
              display: `@${path}`,
            })),
          )
        })
      },
    ),
  )

  const atItems = createMemo(() => {
    const query = store.atQuery.toLowerCase()
    const all = [...agents(), ...atFiles()]
    if (!query) return all.slice(0, 10)
    return all
      .filter((item) => {
        if (item.type === "agent") return item.name.toLowerCase().includes(query)
        return item.path.toLowerCase().includes(query)
      })
      .slice(0, 10)
  })

  const atKey = (item: AtOption) => (item.type === "agent" ? `agent:${item.name}` : `file:${item.path}`)

  // Slash commands — empty by default in portable version
  const slashCommands = createMemo<SlashCommand[]>(() => [])

  // ─── Attachments ───

  const attachments = createPromptAttachments({
    editor: () => editorRef,
    isDialogActive: () => !!dialog.active,
    setDraggingType: (type) => setStore("draggingType", type),
    focusEditor: () => editorRef?.focus(),
    addPart: (part: ContentPart) => {
      if (!editorRef) return false
      const current = prompt.current()
      const cursor = prompt.cursor() ?? getCursorPosition(editorRef)
      prompt.set([...current, part], cursor)
      return true
    },
  })

  // ─── Placeholder ───

  const [placeholder, setPlaceholder] = createSignal("")
  const [placeholderVisible, setPlaceholderVisible] = createSignal(true)
  const [exampleIndex, _setExampleIndex] = createSignal(Math.floor(Math.random() * EXAMPLES.length))

  createEffect(() => {
    const text = promptText()
    setPlaceholderVisible(text.length === 0 && !hasImages())
  })

  createEffect(() => {
    if (!placeholderVisible()) return
    const key = EXAMPLES[exampleIndex()]
    const text = language.t(key)
    setPlaceholder(text)
  })

  // ─── Mirror (prompt → editor DOM sync) ───

  const renderMirror = () => {
    if (!editorRef) return
    mirror.input = true

    const parts = prompt.current().filter((part) => part.type !== "image")
    const cursor = prompt.cursor()
    const text = parts.map((p) => ("content" in p ? p.content : "")).join("")

    const fragment = createTextFragment(text)
    editorRef.innerHTML = ""
    editorRef.appendChild(fragment)

    if (cursor !== undefined) {
      setCursorPosition(editorRef, cursor)
    }

    mirror.input = false
  }

  createEffect(
    on(
      () => prompt.current(),
      () => {
        if (mirror.input) return
        renderMirror()
      },
    ),
  )

  // ─── Editor Event Handlers ───

  const handleInput = () => {
    if (mirror.input) return
    const cursor = getCursorPosition(editorRef)
    const text = editorRef.innerText ?? ""

    // Parse parts from editor text
    const parts: ContentPart[] = [{ type: "text", content: text, start: 0, end: text.length }]
    const existingImages = prompt.current().filter((p): p is ImageAttachmentPart => p.type === "image")

    prompt.set([...parts, ...existingImages], cursor)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    // @ mention trigger
    if (event.key === "@" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (store.popover !== "at") {
        const text = promptText()
        const cursor = getCursorPosition(editorRef)
        const before = text.slice(0, cursor)
        if (!before || /\s$/.test(before)) {
          setStore("popover", "at")
          setStore("atQuery", "")
          setStore("atActive", undefined)
        }
      }
    }

    // Slash command trigger
    if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const text = promptText()
      if (text.length === 0 || (getCursorPosition(editorRef) === 0 && !store.popover)) {
        setStore("popover", "slash")
        setStore("slashQuery", "")
        setStore("slashActive", undefined)
      }
    }

    // Escape to close popover or blur
    if (event.key === "Escape") {
      if (store.popover) {
        setStore("popover", null)
        event.preventDefault()
        return
      }
      editorRef?.blur()
      return
    }

    // Submit on Enter (no shift)
    if (event.key === "Enter" && !event.shiftKey && !store.popover) {
      event.preventDefault()
      void handleSubmit(event)
      return
    }

    // Popover navigation
    if (store.popover === "at") {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const items = atItems()
        if (items.length === 0) return
        const currentIdx = items.findIndex((item) => atKey(item) === store.atActive)
        const delta = event.key === "ArrowDown" ? 1 : -1
        const nextIdx = currentIdx < 0 ? 0 : (currentIdx + delta + items.length) % items.length
        setStore("atActive", atKey(items[nextIdx]))
        return
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        const items = atItems()
        const active = items.find((item) => atKey(item) === store.atActive) ?? items[0]
        if (active) handleAtSelect(active)
        return
      }
    }

    if (store.popover === "slash") {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        return
      }
    }

    // History navigation
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !store.popover) {
      const text = promptText()
      const cursor = getCursorPosition(editorRef)
      if (canNavigateHistoryAtCursor(event.key === "ArrowUp" ? "up" : "down", text, cursor, historyIndex() >= 0)) {
        const result = navigatePromptHistory({
          direction: event.key === "ArrowUp" ? "up" : "down",
          entries: history.entries,
          historyIndex: historyIndex(),
          currentPrompt: prompt.current(),
          currentComments: [],
          savedPrompt: savedPrompt(),
        })
        if (result.handled) {
          event.preventDefault()
          setHistoryIndex(result.historyIndex)
          setSavedPrompt(result.savedPrompt)
          prompt.set(result.entry.prompt, result.cursor === "start" ? 0 : undefined)
        }
      }
    }
  }

  const handleAtSelect = (item: AtOption) => {
    setStore("popover", null)
    if (item.type === "agent") {
      const current = prompt.current()
      const cursor = prompt.cursor() ?? getCursorPosition(editorRef)
      const agentPart: AgentPart = { type: "agent", name: item.name, content: `@${item.name}`, start: 0, end: 0 }
      prompt.set([...current, agentPart], cursor)
    } else {
      const current = prompt.current()
      const cursor = prompt.cursor() ?? getCursorPosition(editorRef)
      const filePart: FileAttachmentPart = { type: "file", path: item.path, content: `@${item.path}`, start: 0, end: 0 }
      prompt.set([...current, filePart], cursor)
    }
  }

  // ─── Submit ───

  const handleSubmit = async (event: Event) => {
    if (busy()) {
      props.handler.abort()
      return
    }
    if (!hasContent()) return

    // Save to history
    setHistory("entries", (entries) => prependHistoryEntry(entries, prompt.current(), []))
    setHistoryIndex(-1)
    setSavedPrompt(null)

    await props.handler.submit(event)
    prompt.reset()
    renderMirror()
    props.onSubmit?.()
  }

  // ─── Context Items ───

  const contextItems = createMemo(() =>
    prompt.context.items().map((item) => ({
      ...item,
      key: item.key,
    })),
  )

  const removeContextItem = (item: ContextItem & { key: string }) => {
    prompt.context.remove(item.key)
  }

  // ─── Render ───

  const agentOptions = createMemo(() =>
    selection.agent.list().map((item) => ({
      value: item.name,
      label: item.name,
    })),
  )

  const variantOptions = createMemo(() =>
    selection.model.variant.list().map((v) => ({
      value: v,
      label: v,
    })),
  )

  const modelName = createMemo(() => {
    const m = model()
    if (!m) return language.t("dialog.model.select.title")
    return m.name
  })

  const providerIcon = createMemo(() => model()?.provider.id)

  const showAbort = createMemo(() => busy())

  return (
    <DockTray>
      <DockShellForm
        class={props.class}
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit(e)
        }}
      >
        <div class="relative flex flex-col">
          {/* Drag overlay */}
          <PromptDragOverlay
            type={store.draggingType}
            label={store.draggingType === "image" ? language.t("prompt.drag.image") : language.t("prompt.drag.mention")}
          />

          {/* Image attachments */}
          <PromptImageAttachments
            attachments={images()}
            onOpen={(attachment) => {
              dialog.show(() => <ImagePreview src={attachment.dataUrl} alt={attachment.filename} />)
            }}
            onRemove={(id) => attachments.removeAttachment(id)}
            removeLabel={language.t("prompt.attachments.remove")}
          />

          {/* Context items */}
          <PromptContextItems
            items={contextItems()}
            active={() => false}
            openComment={() => {}}
            remove={removeContextItem}
            t={(key) => language.t(key)}
          />

          {/* Editor */}
          <div class="relative flex items-end">
            <div ref={scrollRef} class="flex-1 min-h-[44px] max-h-64 overflow-y-auto px-3 py-3" data-scrollable>
              <Show when={placeholderVisible()}>
                <div
                  class="absolute inset-x-3 top-3 text-14-regular text-text-subtle pointer-events-none select-none whitespace-nowrap overflow-hidden"
                  aria-hidden
                >
                  {placeholder()}
                </div>
              </Show>

              {/* biome-ignore lint/a11y/useSemanticElements: custom rich text editor */}
              {/* biome-ignore lint/a11y/useFocusableInteractive: contenteditable natively focusable */}
              <div
                ref={(el) => {
                  editorRef = el
                  props.ref?.(el)
                }}
                role="textbox"
                contentEditable
                class="outline-none text-14-regular text-text-strong whitespace-pre-wrap break-words min-h-[20px]"
                style={{ "padding-right": space }}
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                onPaste={(e) => attachments.handlePaste(e)}
              />
            </div>

            {/* Submit/Stop button */}
            <div class="absolute right-2 bottom-2">
              <Switch>
                <Match when={showAbort()}>
                  <IconButton
                    type="button"
                    icon="stop"
                    variant="ghost"
                    class="size-8"
                    aria-label={language.t("prompt.action.stop")}
                    onClick={() => props.handler.abort()}
                  />
                </Match>
                <Match when={true}>
                  <IconButton
                    type="submit"
                    icon="arrow-up"
                    variant={hasContent() ? "primary" : "ghost"}
                    class="size-8"
                    aria-label={language.t("prompt.action.send")}
                    disabled={!hasContent()}
                  />
                </Match>
              </Switch>
            </div>
          </div>

          {/* @ mention and slash popovers */}
          <PromptPopover
            popover={store.popover}
            setSlashPopoverRef={(el) => {
              _slashPopoverRef = el
            }}
            atFlat={atItems()}
            atActive={store.atActive}
            atKey={atKey}
            setAtActive={(id) => setStore("atActive", id)}
            onAtSelect={handleAtSelect}
            slashFlat={slashCommands()}
            slashActive={store.slashActive}
            setSlashActive={(id) => setStore("slashActive", id)}
            onSlashSelect={() => {}}
            commandKeybind={(id) => keybind()(id) ?? ""}
            t={(key) => language.t(key)}
          />

          {/* Bottom bar: agent/model selectors, file attach */}
          <div class="flex items-center gap-1 px-2 pb-2">
            {/* Agent selector */}
            <Show when={agentOptions().length > 1}>
              <Select
                data-slot="agent-select"
                placement="top-start"
                gutter={8}
                current={agentOptions().find((o) => o.value === agentName())}
                options={agentOptions()}
                value={(x) => x.value}
                label={(x) => x.label}
                onSelect={(item) => selection.agent.set(item?.value)}
                class="h-7 text-13-regular"
                size="sm"
              />
            </Show>

            {/* Model selector */}
            <ChatModelSelector onManageModels={props.onManageModels} onConnectProvider={props.onConnectProvider}>
              <Tooltip placement="top" value={language.t("prompt.action.selectModel")}>
                <button
                  type="button"
                  class="flex items-center gap-1.5 h-7 px-2 rounded-md text-13-regular text-text-weak hover:text-text-strong hover:bg-surface-interactive-weak transition-colors"
                >
                  <Show when={providerIcon()}>{(id) => <ProviderIcon id={id()} class="size-3.5" />}</Show>
                  <span class="truncate max-w-32">{modelName()}</span>
                </button>
              </Tooltip>
            </ChatModelSelector>

            {/* Variant selector */}
            <Show when={variantOptions().length > 0}>
              <Select
                data-slot="variant-select"
                placement="top-start"
                gutter={8}
                current={variantOptions().find((o) => o.value === (selection.model.variant.current() ?? ""))}
                options={variantOptions()}
                value={(x) => x.value}
                label={(x) => x.label}
                onSelect={(item) => selection.model.variant.set(item?.value || undefined)}
                class="h-7 text-13-regular"
                size="sm"
              />
            </Show>

            <div class="flex-1" />

            {/* Attach file button */}
            <Tooltip placement="top" value={language.t("prompt.action.attachFile")}>
              <IconButton
                type="button"
                icon="plus-small"
                variant="ghost"
                class="size-7"
                aria-label={language.t("prompt.action.attachFile")}
                onClick={() => fileInputRef?.click()}
              />
            </Tooltip>
            <input
              ref={(el) => {
                fileInputRef = el
              }}
              type="file"
              class="hidden"
              accept={ACCEPTED_FILE_TYPES.join(",")}
              multiple
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files ?? [])
                for (const file of files) {
                  attachments.addAttachment(file)
                }
                e.currentTarget.value = ""
              }}
            />
          </div>
        </div>
      </DockShellForm>
    </DockTray>
  )
}
