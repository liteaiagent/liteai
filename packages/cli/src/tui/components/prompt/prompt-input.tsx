/**
 * PromptInput orchestrator — the main user input component.
 * Adapted port from MVP `PromptInput/PromptInput.tsx`.
 *
 * The MVP orchestrator was 2339 lines with ~90 imports. This port
 * distills the core responsibilities:
 *
 * 1. Text input with cursor management
 * 2. Mode switching (prompt/bash)
 * 3. Paste handling (text + images)
 * 4. Arrow-key history navigation
 * 5. Exit flow (double-press Escape)
 * 6. Submit routing (via SessionContext)
 * 7. Layout: indicator | input + footer
 *
 * Stripped (deferred to future batches):
 * - Autocomplete / typeahead / suggestions
 * - Prompt suggestion / speculation
 * - Footer pill navigation (tasks, teams, bridge, tmux)
 * - Model picker / fast mode / thinking toggle
 * - Auto-mode opt-in dialog
 * - Stash / undo buffer
 * - External editor ($EDITOR)
 * - Queued commands
 * - Swarm banner
 * - IDE @mention insertion
 * - Voice/STT integration
 * - Agent color / teammate view routing
 * - Fullscreen / alternate screen layout
 * - React Compiler artifacts (_c(), $[n])
 */

import fs from "node:fs/promises"
import { Box, type Color, TerminalSizeContext, useInput } from "@liteai/ink"
import type { Command, FilePartInput } from "@liteai/sdk"
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import stripAnsi from "strip-ansi"
import { useExit } from "../../context/exit"
import { useModalPane } from "../../context/modal-pane"
import { usePromptRef } from "../../context/prompt"
import { useRoute } from "../../context/route"
import { useSDK } from "../../context/sdk"
import { useSession } from "../../context/session"
import { useTheme } from "../../context/theme"
import { useToast } from "../../context/toast"
import { useTuiConfig } from "../../context/tui-config"
import { useArrowKeyHistory } from "../../hooks/use-arrow-key-history"
import { useAtCompleter } from "../../hooks/use-at-completer"
import { useDoublePress } from "../../hooks/use-double-press"
import { useHistorySearch } from "../../hooks/use-history-search"
import { usePasteHandler } from "../../hooks/use-paste-handler"
import { formatSessionExport } from "../../hooks/use-session-export"
import { useSlashSuggestion } from "../../hooks/use-slash-suggestion"
import { useKeybinding } from "../../keybindings/use-keybinding"
import { useAppState, useAppStore } from "../../state"
import { clear as clearQueue, enqueue, getSnapshot } from "../../stores/message-queue-store"
import type { BaseTextInputProps, PromptInputMode, VimMode } from "../../types/text-input"
import { editPromptInEditor } from "../../util/editor"
import { detectInputHighlights } from "../../util/text-highlighting"
import { DialogAgentList } from "../dialog-agent-list"
import { DialogConfig } from "../dialog-config"
import { DialogContext as DialogContextView } from "../dialog-context"
import { DialogDiff } from "../dialog-diff"
import { DialogDoctor } from "../dialog-doctor"
import { DialogEffort } from "../dialog-effort"
import { DialogExportOptions } from "../dialog-export-options"
import { DialogHelp } from "../dialog-help"
import { DialogMcp } from "../dialog-mcp"
import { DialogMemory } from "../dialog-memory"
import { DialogModel } from "../dialog-model"
import { DialogOutputStyle } from "../dialog-output-style"
import { DialogPermissions } from "../dialog-permissions"
import { DialogPlugin } from "../dialog-plugin"
import { DialogProvider } from "../dialog-provider"
import { DialogRewind } from "../dialog-rewind"
import { DialogSearch } from "../dialog-search"
import { DialogSessionList } from "../dialog-session-list"
import { DialogStats } from "../dialog-stats"
import { DialogStatus } from "../dialog-status"
import { DialogTheme } from "../dialog-theme"
import { TextInput } from "../text-input"
import VimTextInput from "../vim-text-input"
import { getModeFromInput, getValueFromInput } from "./input-modes"
import type { PastedContent } from "./input-paste"
import { maybeTruncateInput } from "./input-paste"
import { PromptInputFooter } from "./prompt-input-footer"
import { PromptInputModeIndicator } from "./prompt-input-mode-indicator"
import { QueuedMessageDisplay } from "./queued-message-display"
import { useCommandSuggestions } from "./use-command-suggestions"
import { isVimModeEnabled } from "./utils"
import { processAtReferences } from "./utils/at-processor"
import { applyAtCompletion } from "./utils/at-token"
import { applyCommandSuggestion } from "./utils/command-suggestions"

// ─── Constants ───────────────────────────────────────────────────────────────

/** Reserve lines for footer, border, etc. */
const PROMPT_FOOTER_LINES = 5
const MIN_INPUT_VIEWPORT_LINES = 3

// ─── Props ───────────────────────────────────────────────────────────────────

type PromptInputProps = {
  readonly debug: boolean
  readonly verbose: boolean
  readonly isLoading: boolean
  readonly hint?: React.ReactNode
  readonly workspaceID?: string
  /** When true, input is suppressed (cursor mode is active) */
  readonly cursorModeActive?: boolean
  readonly onSearch?: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export const TUI_COMMANDS: Command[] = [
  { name: "agents", description: "Manage custom agents", template: "", hints: [] },
  { name: "compact", description: "Summarize and compact the session history", template: "", hints: [] },
  { name: "config", description: "Open config panel", template: "", hints: [] },
  { name: "context", description: "View token usage breakdown and limits", template: "", hints: [] },
  { name: "diff", description: "View modified files in the session", template: "", hints: [] },
  { name: "doctor", description: "Run system diagnostics", template: "", hints: [] },
  { name: "effort", description: "Set model effort level", template: "", hints: [] },
  { name: "export", description: "Export session transcript to a file", template: "", hints: [] },
  { name: "find", description: "Search file contents across the workspace", template: "", hints: [] },
  { name: "help", description: "Show help and keyboard shortcuts", template: "", hints: [] },
  {
    name: "history",
    description: "Time-travel through conversation history (alias for /rewind)",
    template: "",
    hints: [],
  },
  { name: "mcp", description: "Manage Model Context Protocol servers", template: "", hints: [] },
  { name: "models", description: "Change the current AI model", template: "", hints: [] },
  { name: "clear", description: "Start a new conversation session", template: "", hints: [] },
  { name: "permissions", description: "View pending permission requests", template: "", hints: [] },
  { name: "plan", description: "Toggle plan mode (think before acting)", template: "", hints: [] },
  { name: "plugins", description: "Manage installed plugins", template: "", hints: [] },
  { name: "provider", description: "Connect or disconnect AI providers", template: "", hints: [] },
  { name: "rewind", description: "Time-travel through conversation history", template: "", hints: [] },
  { name: "sessions", description: "List and switch between sessions", template: "", hints: [] },
  { name: "stats", description: "Show session statistics and token usage", template: "", hints: [] },
  { name: "status", description: "Show system status", template: "", hints: [] },
  { name: "theme", description: "Change the color theme", template: "", hints: [] },
  {
    name: "timeline",
    description: "Time-travel through conversation history (alias for /rewind)",
    template: "",
    hints: [],
  },
]

export function PromptInput({ debug, verbose, isLoading, hint, cursorModeActive, onSearch }: PromptInputProps) {
  const config = useTuiConfig()
  const session = useSession()
  const exit = useExit()
  const toast = useToast()
  const route = useRoute()
  const store = useAppStore()
  const command = useAppState((s) => s.command)
  const agent = useAppState((s) => s.agent)
  const mcp_resource = useAppState((s) => s.mcp_resource)
  const { theme } = useTheme()
  const modalPane = useModalPane()
  const promptRefCtx = usePromptRef()
  const sdk = useSDK()

  // ── Modal-aware focus ──────────────────────────────────────────────────
  // When a modal pane (e.g., /models, /theme) is open, all prompt input handling
  // must be disabled so arrow keys, Enter, and character input only reach the
  // active modal. Without this gate, both the modal and the prompt's text
  // input process the same keystrokes simultaneously.
  const isDialogOpen = modalPane.isOpen

  // ── Terminal dimensions ─────────────────────────────────────────────────
  const terminalSize = useContext(TerminalSizeContext)
  const columns = terminalSize?.columns ?? 80
  const rows = terminalSize?.rows ?? 24
  const textInputColumns = columns - 3 // account for mode indicator

  // ── Core input state ────────────────────────────────────────────────────
  const [input, setInput] = useState("")
  const [cursorOffset, setCursorOffset] = useState(0)
  const [mode, setMode] = useState<PromptInputMode>("prompt")
  const [vimMode, setVimMode] = useState<VimMode>("INSERT")
  const [pastedContents, setPastedContents] = useState<Record<number, PastedContent>>({})
  const [exitMessage, setExitMessage] = useState<{ show: boolean; key?: string }>({ show: false })
  const stashRef = useRef<{ text: string; mode: PromptInputMode; cursor: number } | null>(null)

  // ── History search state ────────────────────────────────────────────────
  const searchState = useHistorySearch()

  const commandSuggestions = useCommandSuggestions(input, cursorOffset, [...(command ?? []), ...TUI_COMMANDS])

  const atCompleter = useAtCompleter({
    input,
    cursorOffset,
    agents: agent as import("@liteai/sdk").Agent[],
    mcpResources: mcp_resource,
    projectID: sdk.projectID,
    sdk: sdk.client,
    enabled: !searchState.isSearching && !isDialogOpen && !cursorModeActive,
  })

  const [atSelectedIndex, setAtSelectedIndex] = useState(0)
  useEffect(() => {
    setAtSelectedIndex(0)
  }, [atCompleter.items])

  // ── Paste ID counter ────────────────────────────────────────────────────
  const nextPasteIdRef = useRef(1)

  // ── Derived state ───────────────────────────────────────────────────────
  const isInputWrapped = useMemo(() => input.includes("\n"), [input])
  const maxVisibleLines = useMemo(
    () => Math.max(MIN_INPUT_VIEWPORT_LINES, Math.floor(rows / 2) - PROMPT_FOOTER_LINES),
    [rows],
  )

  // ── Input tracking (external changes) ───────────────────────────────────
  const lastInternalInputRef = useRef(input)
  if (input !== lastInternalInputRef.current) {
    setCursorOffset(input.length)
    lastInternalInputRef.current = input
  }

  const trackAndSetInput = useCallback((value: string) => {
    lastInternalInputRef.current = value
    setInput(value)
  }, [])

  // ── onChange handler ────────────────────────────────────────────────────
  const onChange = useCallback(
    (value: string) => {
      // Check for single char mode prefix at start
      const isSingleCharInsertion = value.length === input.length + 1
      const insertedAtStart = cursorOffset === 0
      const detectedMode = getModeFromInput(value)
      if (insertedAtStart && detectedMode !== "prompt") {
        if (isSingleCharInsertion) {
          setMode(detectedMode)
          return
        }
        if (input.length === 0) {
          setMode(detectedMode)
          const stripped = getValueFromInput(value).replaceAll("\t", "    ")
          trackAndSetInput(stripped)
          setCursorOffset(stripped.length)
          return
        }
      }

      const processed = value.replaceAll("\t", "    ")
      trackAndSetInput(processed)
    },
    [trackAndSetInput, input, cursorOffset],
  )

  // ── History navigation ──────────────────────────────────────────────────
  const loadEntries = useCallback(
    async function* (): AsyncGenerator<{
      display: string
      pastedContents?: Record<number, unknown>
    }> {
      const sessionID = session.sessionID
      if (!sessionID) return

      const state = store.getState()
      const messages = state.message[sessionID] ?? []

      // Iterate reverse to yield newest messages first
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg && msg.role === "user") {
          const parts = state.part[msg.id] ?? []
          const textPart = parts.find((p) => p.type === "text")
          if (textPart && textPart.type === "text" && textPart.text) {
            yield { display: textPart.text }
          }
        }
      }
    },
    [session.sessionID, store],
  )

  const { onHistoryUp, onHistoryDown, resetHistory } = useArrowKeyHistory({
    onSetInput: (value: string) => {
      onChange(value)
    },
    currentInput: input,
    setCursorOffset,
    loadEntries: loadEntries,
  })

  const handleHistoryUp = useCallback(() => {
    if (atCompleter.active && atCompleter.items.length > 0) {
      setAtSelectedIndex((prev) => Math.max(0, prev - 1))
      return
    }
    if (commandSuggestions.active && commandSuggestions.suggestions.length > 0) {
      commandSuggestions.navigateUp()
      return
    }
    onHistoryUp()
  }, [atCompleter.active, atCompleter.items.length, commandSuggestions, onHistoryUp])

  const handleHistoryDown = useCallback(() => {
    if (atCompleter.active && atCompleter.items.length > 0) {
      setAtSelectedIndex((prev) => Math.min(atCompleter.items.length - 1, prev + 1))
      return
    }
    if (commandSuggestions.active && commandSuggestions.suggestions.length > 0) {
      commandSuggestions.navigateDown()
      return
    }
    onHistoryDown()
  }, [atCompleter.active, atCompleter.items.length, commandSuggestions, onHistoryDown])

  // ── Truncation ──────────────────────────────────────────────────────────
  // Automatically truncate large pasted text into references
  const lastTruncatedRef = useRef("")
  if (input !== lastTruncatedRef.current && input.length > 10_000) {
    const { newInput, newPastedContents } = maybeTruncateInput(input, pastedContents)
    if (newInput !== input) {
      lastTruncatedRef.current = newInput
      trackAndSetInput(newInput)
      setCursorOffset(newInput.length)
      setPastedContents(newPastedContents)
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  // ── TUI-only command interceptors ────────────────────────────────────
  // These commands are handled entirely client-side (open a dialog).
  // Extracted so both the suggestion branch and direct-input branch can use them.
  const tuiInterceptors: Record<string, () => void> = useMemo(
    () => ({
      agents: () => modalPane.openModal(<DialogAgentList onClose={modalPane.closeModal} />),
      compact: () => {
        if (session.sessionID) {
          void sdk.client.project.session.summarize({ sessionID: session.sessionID, projectID: sdk.projectID })
        }
      },
      config: () => modalPane.openModal(<DialogConfig onClose={modalPane.closeModal} />),
      context: () => modalPane.openModal(<DialogContextView onClose={modalPane.closeModal} />),
      diff: () => modalPane.openModal(<DialogDiff onClose={modalPane.closeModal} />),
      doctor: () => modalPane.openModal(<DialogDoctor onClose={modalPane.closeModal} />),
      effort: () => modalPane.openModal(<DialogEffort onClose={modalPane.closeModal} />),
      export: () => {
        const sid = session.sessionID
        if (!sid) return
        modalPane.openModal(
          <DialogExportOptions
            defaultFilename={`liteai-session-${sid.slice(0, 8)}.md`}
            defaultThinking={false}
            defaultToolDetails={true}
            defaultAssistantMetadata={false}
            defaultOpenWithoutSaving={false}
            onConfirm={async (opts) => {
              const state = store.getState()
              const messages = state.message[sid] ?? []
              const parts = state.part
              const content = formatSessionExport(
                messages as import("@liteai/sdk").Message[],
                parts as Record<string, import("@liteai/sdk").Part[]>,
                opts,
              )
              if (opts.openWithoutSaving) {
                editPromptInEditor(content)
              } else {
                await fs.writeFile(opts.filename, content, "utf-8")
                toast.show({ variant: "success", message: `Exported to ${opts.filename}` })
              }
              modalPane.closeModal()
            }}
            onCancel={modalPane.closeModal}
          />,
        )
      },
      find: () => modalPane.openModal(<DialogSearch onClose={modalPane.closeModal} />),
      search: () => onSearch?.(),
      help: () => modalPane.openModal(<DialogHelp onClose={modalPane.closeModal} />),
      history: () => modalPane.openModal(<DialogRewind onClose={modalPane.closeModal} />),
      mcp: () => modalPane.openModal(<DialogMcp onClose={modalPane.closeModal} />),
      memory: () => modalPane.openModal(<DialogMemory onClose={modalPane.closeModal} />),
      models: () => modalPane.openModal(<DialogModel onClose={modalPane.closeModal} />),
      clear: () => route.navigate({ type: "session" }),
      permissions: () => modalPane.openModal(<DialogPermissions onClose={modalPane.closeModal} />),
      plan: () => {
        const sid = session.sessionID
        if (!sid) return
        // biome-ignore lint/suspicious/noExplicitAny: SDK method not typed yet
        const planModeApi = (sdk.client.project.session as any).planMode
        if (planModeApi) {
          void planModeApi.toggle({ sessionID: sid, projectID: sdk.projectID })
          toast.show({ variant: "info", message: "Plan mode toggled" })
        } else {
          toast.show({ variant: "warning", message: "Plan mode not supported yet" })
        }
      },
      plugins: () => modalPane.openModal(<DialogPlugin onClose={modalPane.closeModal} />),
      provider: () => modalPane.openModal(<DialogProvider onClose={modalPane.closeModal} />),
      rewind: () => modalPane.openModal(<DialogRewind onClose={modalPane.closeModal} />),
      sessions: () => modalPane.openModal(<DialogSessionList onClose={modalPane.closeModal} />),
      theme: () => modalPane.openModal(<DialogTheme onClose={modalPane.closeModal} />),
      timeline: () => modalPane.openModal(<DialogRewind onClose={modalPane.closeModal} />),
      status: () => modalPane.openModal(<DialogStatus onClose={modalPane.closeModal} />),
      style: () => modalPane.openModal(<DialogOutputStyle onDone={modalPane.closeModal} />),
      settings: () => modalPane.openModal(<DialogConfig onClose={modalPane.closeModal} />),
      stats: () => {
        const sid = session.sessionID
        if (sid) {
          modalPane.openModal(<DialogStats sessionID={sid} onClose={modalPane.closeModal} />)
        }
      },
    }),
    [modalPane, route, session.sessionID, sdk.client, sdk.projectID],
  )

  const onSubmit = useCallback(
    async (inputParam: string) => {
      if (atCompleter.active && atCompleter.items.length > 0 && atCompleter.token) {
        const selected = atCompleter.items[atSelectedIndex]
        if (selected) {
          const result = applyAtCompletion(
            input,
            cursorOffset,
            atCompleter.token,
            selected.displayText,
            selected.isDirectory,
          )
          trackAndSetInput(result.newInput)
          setCursorOffset(result.newCursorOffset)
        }
        return
      }

      if (commandSuggestions.active && commandSuggestions.suggestions.length > 0) {
        const selected = commandSuggestions.getSelected()
        if (selected) {
          const selectedCmdName = selected.id

          // Check TUI interceptors first — dispatch directly to avoid recursion.
          // applyCommandSuggestion calls onSubmit recursively, which re-enters
          // the suggestion branch (suggestions are still active in the closure)
          // and causes an infinite loop. TUI commands don't need formatting or
          // server submission, so we short-circuit here.
          const interceptor = tuiInterceptors[selectedCmdName]
          if (interceptor) {
            if (modalPane.isOpen) return // Prevent double-open
            interceptor()
            trackAndSetInput("")
            setCursorOffset(0)
            return
          }

          // For server-side commands, apply the suggestion and submit directly
          // without re-entering this handler (avoids the recursion bug).
          applyCommandSuggestion(
            selected,
            true, // shouldExecute
            [...(command ?? []), ...TUI_COMMANDS],
            input,
            commandSuggestions.midCommandMatch,
            (value) => trackAndSetInput(value),
            setCursorOffset,
            async (value) => {
              const trimmedCmd = value.trimEnd()
              if (trimmedCmd === "" || trimmedCmd === "/") return
              await session.submit(trimmedCmd, mode, undefined)
              trackAndSetInput("")
              setCursorOffset(0)
              setPastedContents({})
              resetHistory()
            },
          )
        }
        return
      }

      if (searchState.isSearching) {
        if (searchState.match) {
          trackAndSetInput(searchState.match.display)
          setCursorOffset(searchState.match.display.length)
        }
        searchState.cancelSearch()
        return
      }

      const trimmed = inputParam.trimEnd()

      if (trimmed === "?") {
        modalPane.openModal(<DialogHelp onClose={modalPane.closeModal} />)
        trackAndSetInput("")
        setCursorOffset(0)
        return
      }

      const cmdMatch = trimmed.match(/^\/([a-zA-Z0-9_:-]+)$/)
      if (cmdMatch) {
        const cmdName = cmdMatch[1]
        const interceptor = tuiInterceptors[cmdName]
        if (interceptor) {
          if (modalPane.isOpen) return // Prevent double-open
          interceptor()
          trackAndSetInput("")
          setCursorOffset(0)
          return
        }
      }

      if (trimmed === "" && Object.values(pastedContents).every((c) => c.type !== "image")) {
        return
      }

      // Build image attachments from pastedContents as data URLs
      const imageAttachments = Object.values(pastedContents)
        .filter((c) => c.type === "image")
        .map((c) => {
          const mime = c.mediaType ?? "image/png"
          return {
            type: "file" as const,
            mime,
            url: `data:${mime};base64,${c.content}`,
            filename: c.filename ?? "image.png",
          } as FilePartInput
        })

      if (isLoading && trimmed) {
        enqueue(trimmed, mode)
        trackAndSetInput("")
        setCursorOffset(0)
        setPastedContents({})
        return
      }

      let finalInput = trimmed

      if (trimmed.includes("@")) {
        const processed = await processAtReferences({
          input: trimmed,
          agents: agent as import("@liteai/sdk").Agent[],
          sdk: sdk.client,
          projectID: sdk.projectID,
        })
        finalInput = processed.processedText
        if (processed.agentNudge) {
          finalInput += `\n${processed.agentNudge}`
        }
      }

      await session.submit(finalInput, mode, imageAttachments.length > 0 ? imageAttachments : undefined)

      // Reset input state after submission
      trackAndSetInput("")
      setCursorOffset(0)
      setPastedContents({})
      resetHistory()
    },
    [
      pastedContents,
      session,
      mode,
      trackAndSetInput,
      resetHistory,
      searchState,
      commandSuggestions,
      input,
      command,
      agent,
      sdk,
      tuiInterceptors,
      modalPane,
      atCompleter,
      atSelectedIndex,
      isLoading,
    ],
  )

  // ── Register PromptRef ──────────────────────────────────────────────────
  useEffect(() => {
    promptRefCtx.set({
      focused: !isDialogOpen && !cursorModeActive,
      current: { input, parts: [] },
      set: () => {},
      reset: () => {
        trackAndSetInput("")
        setCursorOffset(0)
        setPastedContents({})
      },
      blur: () => {},
      focus: () => {},
      submit: () => {
        void onSubmit(input)
      },
      prefill: (text: string) => {
        setMode("prompt")
        trackAndSetInput(text)
        setCursorOffset(text.length)
        setPastedContents({})
      },
    })
    return () => promptRefCtx.set(undefined)
  }, [isDialogOpen, cursorModeActive, mode, input, trackAndSetInput, setCursorOffset, onSubmit, promptRefCtx])

  // ── Image paste handler ─────────────────────────────────────────────────
  const onImagePaste = useCallback(
    (base64Image: string, mediaType?: string, filename?: string) => {
      setMode("prompt")
      const pasteId = nextPasteIdRef.current++
      const newContent: PastedContent = {
        id: pasteId,
        type: "image",
        content: base64Image,
        mediaType: mediaType ?? "image/png",
        filename: filename ?? "Pasted image",
      }
      setPastedContents((prev) => ({ ...prev, [pasteId]: newContent }))

      // Insert [Image #N] reference at cursor
      const ref = `[Image #${pasteId}]`
      const newInput = input.slice(0, cursorOffset) + ref + input.slice(cursorOffset)
      trackAndSetInput(newInput)
      setCursorOffset(cursorOffset + ref.length)
    },
    [input, cursorOffset, trackAndSetInput],
  )

  // ── Text paste handler ──────────────────────────────────────────────────
  const onTextPaste = useCallback(
    (rawText: string) => {
      let text = stripAnsi(rawText).replace(/\r/g, "\n").replaceAll("\t", "    ")

      // Match typed/auto-suggest: `!cmd` pasted into empty input enters bash mode
      if (input.length === 0) {
        const pastedMode = getModeFromInput(text)
        if (pastedMode !== "prompt") {
          setMode(pastedMode)
          text = getValueFromInput(text)
        }
      }

      const maxLines = Math.min(rows - 10, 2)
      const numLines = text.split("\n").length

      if (text.length > 800 || numLines > maxLines) {
        const pasteId = nextPasteIdRef.current++
        const newContent: PastedContent = {
          id: pasteId,
          type: "text",
          content: text,
        }
        setPastedContents((prev) => ({ ...prev, [pasteId]: newContent }))
        const ref = `[...Truncated text #${pasteId} +${numLines} lines...]`
        const newInput = input.slice(0, cursorOffset) + ref + input.slice(cursorOffset)
        trackAndSetInput(newInput)
        setCursorOffset(cursorOffset + ref.length)
      } else {
        const newInput = input.slice(0, cursorOffset) + text + input.slice(cursorOffset)
        trackAndSetInput(newInput)
        setCursorOffset(cursorOffset + text.length)
      }
    },
    [input, cursorOffset, trackAndSetInput, rows],
  )

  // ── Paste handler hook ──────────────────────────────────────────────────
  const { isPasting } = usePasteHandler({
    onPaste: onTextPaste,
    onInput: () => {
      // Handled by TextInput/VimTextInput internally
    },
    onImagePaste,
  })

  // ── Exit double-press ───────────────────────────────────────────────────
  const [_exitPending, setExitPending] = useState(false)
  const doublePressEsc = useDoublePress(setExitPending, () => {
    // Double-press: hard exit
    void exit()
  })

  useKeybinding("history:search", () => {
    searchState.startSearch()
  })

  useKeybinding("chat:agents", () => {
    modalPane.openModal(<DialogAgentList onClose={modalPane.closeModal} />)
  })

  useKeybinding("chat:stash", () => {
    if (stashRef.current === null) {
      if (input.length === 0) return
      stashRef.current = { text: input, mode, cursor: cursorOffset }
      trackAndSetInput("")
      setCursorOffset(0)
      setMode("prompt")
    } else {
      const saved = stashRef.current
      if (input.length > 0) {
        stashRef.current = { text: input, mode, cursor: cursorOffset }
      } else {
        stashRef.current = null
      }
      trackAndSetInput(saved.text)
      setCursorOffset(saved.cursor)
      setMode(saved.mode)
    }
  })

  useKeybinding("chat:externalEditor", () => {
    const result = editPromptInEditor(input)
    if (result.content !== null) {
      trackAndSetInput(result.content)
      setCursorOffset(result.content.length)
    }
  })

  useKeybinding("chat:cancel", () => {
    const queued = getSnapshot()
    if (queued.length > 0) {
      clearQueue()
      return
    }

    if (searchState.isSearching) {
      searchState.cancelSearch()
      return
    }

    if (isLoading) {
      void session.abort()
      doublePressEsc()
      return
    }

    if (input.length > 0) {
      trackAndSetInput("")
      setCursorOffset(0)
      setPastedContents({})
      return
    }

    doublePressEsc()
  })

  // ── Global key handler ──────────────────────────────────────────────────
  useInput(
    (_char, key) => {
      if (key.return && exitMessage.show) {
        setExitMessage({ show: false })
      }
    },
    { isActive: !isDialogOpen && !cursorModeActive },
  )

  // ── Border color ────────────────────────────────────────────────────────
  const borderColor = useMemo((): Color => {
    if (mode === "bash") {
      return theme.warning as Color
    }
    return theme.border as Color
  }, [mode, theme])

  // ── Highlights & Ghost Text ─────────────────────────────────────────────
  const knownCommands = useMemo(
    () => [...command.map((cmd) => cmd.name), ...TUI_COMMANDS.map((cmd) => cmd.name)],
    [command],
  )

  const highlights = useMemo(() => {
    if (mode !== "prompt" || searchState.isSearching) return []
    return detectInputHighlights(input, knownCommands)
  }, [input, mode, knownCommands, searchState.isSearching])

  const inlineGhostText = useSlashSuggestion(searchState.isSearching ? "" : input, cursorOffset, knownCommands)

  const onTab = useMemo(() => {
    if (atCompleter.active && atCompleter.items.length > 0 && atCompleter.token) {
      const token = atCompleter.token
      return () => {
        const selected = atCompleter.items[atSelectedIndex]
        if (!selected) return
        const result = applyAtCompletion(input, cursorOffset, token, selected.displayText, selected.isDirectory)
        trackAndSetInput(result.newInput)
        setCursorOffset(result.newCursorOffset)
      }
    }

    if (commandSuggestions.active && commandSuggestions.suggestions.length > 0) {
      return () => {
        const selected = commandSuggestions.getSelected()
        if (selected) {
          applyCommandSuggestion(
            selected,
            false,
            [...(command ?? []), ...TUI_COMMANDS],
            input,
            commandSuggestions.midCommandMatch,
            (value) => trackAndSetInput(value),
            setCursorOffset,
            () => {},
          )
        }
      }
    }

    if (!inlineGhostText) return undefined
    return () => {
      const before = input.slice(0, inlineGhostText.insertPosition)
      const after = input.slice(inlineGhostText.insertPosition)
      const newText = `${before}${inlineGhostText.text} ${after}`
      trackAndSetInput(newText)
      setCursorOffset(inlineGhostText.insertPosition + inlineGhostText.text.length + 1)
    }
  }, [
    inlineGhostText,
    input,
    trackAndSetInput,
    setCursorOffset,
    commandSuggestions,
    atCompleter,
    atSelectedIndex,
    cursorOffset,
  ])

  // ── Render ──────────────────────────────────────────────────────────────
  const baseProps: BaseTextInputProps = {
    multiline: true,
    disableCursorMovementForUpDownKeys: commandSuggestions.active || atCompleter.active,
    onSubmit,
    onChange,
    value: input,
    onHistoryUp: handleHistoryUp,
    onHistoryDown: handleHistoryDown,
    onHistoryReset: resetHistory,
    placeholder: "How can I help you?",
    onExit: () => {
      void exit()
    },
    onExitMessage: (show, key) => setExitMessage({ show, key }),
    onImagePaste,
    columns: textInputColumns,
    maxVisibleLines,
    cursorOffset,
    onChangeCursorOffset: setCursorOffset,
    onPaste: onTextPaste,
    onIsPastingChange: () => {
      // paste state managed by usePasteHandler
    },
    focus: !searchState.isSearching && !isDialogOpen && !cursorModeActive,
    showCursor: !searchState.isSearching && !isDialogOpen && !cursorModeActive,
    highlights,
    inlineGhostText,
    onTab,
  }

  const displayInput = searchState.isSearching && searchState.match ? searchState.match.display : input

  const textInputElement = isVimModeEnabled(config) ? (
    <VimTextInput {...baseProps} value={displayInput} initialMode={vimMode} onModeChange={setVimMode} />
  ) : (
    <TextInput {...baseProps} value={displayInput} dimColor={searchState.isSearching} />
  )

  return (
    <Box flexDirection="column" marginTop={1}>
      <QueuedMessageDisplay />
      <Box
        flexDirection="row"
        alignItems="flex-start"
        justifyContent="flex-start"
        borderColor={borderColor}
        borderStyle="round"
        borderLeft={false}
        borderRight={false}
        borderBottom
        width="100%"
      >
        <PromptInputModeIndicator mode={mode} isLoading={isLoading} />
        <Box flexGrow={1} flexShrink={1}>
          {textInputElement}
        </Box>
      </Box>

      <PromptInputFooter
        debug={debug}
        verbose={verbose}
        exitMessage={exitMessage}
        vimMode={isVimModeEnabled(config) ? vimMode : undefined}
        mode={mode}
        isLoading={isLoading}
        isPasting={isPasting}
        isInputWrapped={isInputWrapped}
        config={config}
        hint={hint}
        searchState={{
          isSearching: searchState.isSearching,
          query: searchState.query,
          setQuery: searchState.setQuery,
          hasFailedMatch: searchState.query.length > 0 && !searchState.match,
        }}
        commandSuggestions={commandSuggestions.suggestions}
        commandSelectedIndex={commandSuggestions.selectedIndex}
        atSuggestions={atCompleter.active ? atCompleter.items : []}
        atSelectedIndex={atSelectedIndex}
        atIsLoading={atCompleter.isLoading}
      />
    </Box>
  )
}

export default PromptInput
