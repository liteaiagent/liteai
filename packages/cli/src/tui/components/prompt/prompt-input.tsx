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

import { Box, type Color, TerminalSizeContext, useInput } from "@liteai/ink"
import type { Command, FilePartInput } from "@liteai/sdk"
import { useCallback, useContext, useMemo, useRef, useState } from "react"
import stripAnsi from "strip-ansi"
import { useDialog } from "../../context/dialog"
import { useRoute } from "../../context/route"
import { useSession } from "../../context/session"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { useArrowKeyHistory } from "../../hooks/use-arrow-key-history"
import { useDoublePress } from "../../hooks/use-double-press"
import { useHistorySearch } from "../../hooks/use-history-search"
import { usePasteHandler } from "../../hooks/use-paste-handler"
import { useSlashSuggestion } from "../../hooks/use-slash-suggestion"
import { useKeybinding } from "../../keybindings/use-keybinding"
import type { BaseTextInputProps, PromptInputMode, VimMode } from "../../types/text-input"
import { DialogHelp } from "../../ui/dialog-help"
import { detectInputHighlights } from "../../util/text-highlighting"
import { DialogMcp } from "../dialog-mcp"
import { DialogModel } from "../dialog-model"
import { DialogPlugin } from "../dialog-plugin"
import { DialogSessionList } from "../dialog-session-list"
import { DialogSettings } from "../dialog-settings"
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
import { useCommandSuggestions } from "./use-command-suggestions"
import { isVimModeEnabled } from "./utils"
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
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PromptInput({ debug, verbose, isLoading, hint }: PromptInputProps) {
  const config = useTuiConfig()
  const session = useSession()
  const route = useRoute()
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()

  // ── Dialog-aware focus ──────────────────────────────────────────────────
  // When a dialog (e.g., /models, /theme) is open, all prompt input handling
  // must be disabled so arrow keys, Enter, and character input only reach the
  // active dialog. Without this gate, both the dialog and the prompt's text
  // input process the same keystrokes simultaneously.
  const isDialogOpen = dialog.stack.length > 0

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

  // ── History search state ────────────────────────────────────────────────
  const searchState = useHistorySearch()

  const tuiCommands: Command[] = useMemo(
    () => [
      { name: "mcp", description: "Manage Model Context Protocol servers", template: "", hints: [] },
      { name: "models", description: "Change the current AI model", template: "", hints: [] },
      { name: "new", description: "Start a new conversation session", template: "", hints: [] },
      { name: "plugins", description: "Manage installed plugins", template: "", hints: [] },
      { name: "sessions", description: "List and switch between sessions", template: "", hints: [] },
      { name: "settings", description: "Open settings", template: "", hints: [] },
      { name: "theme", description: "Change the color theme", template: "", hints: [] },
      { name: "status", description: "Show system status", template: "", hints: [] },
      { name: "stats", description: "Show session statistics and token usage", template: "", hints: [] },
    ],
    [],
  )

  const commandSuggestions = useCommandSuggestions(input, cursorOffset, [...(sync.command ?? []), ...tuiCommands])

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

      const messages = sync.message[sessionID] ?? []

      // Iterate reverse to yield newest messages first
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg && msg.role === "user") {
          const parts = sync.part[msg.id] ?? []
          const textPart = parts.find((p) => p.type === "text")
          if (textPart && textPart.type === "text" && textPart.text) {
            yield { display: textPart.text }
          }
        }
      }
    },
    [sync.message, sync.part, session.sessionID],
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
    if (commandSuggestions.active && commandSuggestions.suggestions.length > 0) {
      commandSuggestions.navigateUp()
      return
    }
    onHistoryUp()
  }, [commandSuggestions, onHistoryUp])

  const handleHistoryDown = useCallback(() => {
    if (commandSuggestions.active && commandSuggestions.suggestions.length > 0) {
      commandSuggestions.navigateDown()
      return
    }
    onHistoryDown()
  }, [commandSuggestions, onHistoryDown])

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
      mcp: () => dialog.push(() => <DialogMcp />),
      models: () => dialog.push(() => <DialogModel />),
      new: () => route.navigate({ type: "home" }),
      plugins: () => dialog.push(() => <DialogPlugin />),
      sessions: () => dialog.push(() => <DialogSessionList />),
      settings: () => dialog.push(() => <DialogSettings />),
      theme: () => dialog.push(() => <DialogTheme />),
      status: () => dialog.push(() => <DialogStatus />),
      stats: () => {
        const sid = session.sessionID
        if (sid) {
          dialog.push(() => <DialogStats sessionID={sid} />)
        }
      },
    }),
    [dialog, route, session.sessionID],
  )

  const onSubmit = useCallback(
    async (inputParam: string) => {
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
            [...(sync.command ?? []), ...tuiCommands],
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
        dialog.push(() => <DialogHelp />)
        trackAndSetInput("")
        setCursorOffset(0)
        return
      }

      const cmdMatch = trimmed.match(/^\/([a-zA-Z0-9_:-]+)$/)
      if (cmdMatch) {
        const cmdName = cmdMatch[1]
        const interceptor = tuiInterceptors[cmdName]
        if (interceptor) {
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
      const imageAttachments: FilePartInput[] = Object.values(pastedContents)
        .filter((c) => c.type === "image")
        .map((c) => {
          const mime = c.mediaType ?? "image/png"
          return {
            type: "file" as const,
            mime,
            url: `data:${mime};base64,${c.content}`,
            filename: c.filename ?? "image.png",
          }
        })

      await session.submit(trimmed, mode, imageAttachments.length > 0 ? imageAttachments : undefined)

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
      sync.command,
      tuiCommands,
      tuiInterceptors,
      dialog,
    ],
  )

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
    // Double-press: abort if loading
    if (isLoading) {
      void session.abort()
    }
  })

  useKeybinding("history:search", () => {
    searchState.startSearch()
  })

  useKeybinding("chat:cancel", () => {
    if (searchState.isSearching) {
      searchState.cancelSearch()
      return
    }

    if (isLoading) {
      void session.abort()
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
    { isActive: !isDialogOpen },
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
    () => [...sync.command.map((cmd) => cmd.name), ...tuiCommands.map((cmd) => cmd.name)],
    [sync.command, tuiCommands],
  )

  const highlights = useMemo(() => {
    if (mode !== "prompt" || searchState.isSearching) return []
    return detectInputHighlights(input, knownCommands)
  }, [input, mode, knownCommands, searchState.isSearching])

  const inlineGhostText = useSlashSuggestion(searchState.isSearching ? "" : input, cursorOffset, knownCommands)

  const onTab = useMemo(() => {
    if (commandSuggestions.active && commandSuggestions.suggestions.length > 0) {
      return () => {
        const selected = commandSuggestions.getSelected()
        if (selected) {
          applyCommandSuggestion(
            selected,
            false,
            [...(sync.command ?? []), ...tuiCommands],
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
  }, [inlineGhostText, input, trackAndSetInput, setCursorOffset, commandSuggestions])

  // ── Render ──────────────────────────────────────────────────────────────
  const baseProps: BaseTextInputProps = {
    multiline: true,
    onSubmit,
    onChange,
    value: input,
    onHistoryUp: handleHistoryUp,
    onHistoryDown: handleHistoryDown,
    onHistoryReset: resetHistory,
    placeholder: "How can I help you?",
    onExit: () => {
      // TODO: wire to app-level exit
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
    focus: !searchState.isSearching && !isDialogOpen,
    showCursor: !searchState.isSearching && !isDialogOpen,
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
      />
    </Box>
  )
}

export default PromptInput
