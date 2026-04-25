/** @jsxImportSource react */
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
import type { FilePartInput } from "@liteai/sdk"
import { useCallback, useContext, useMemo, useRef, useState } from "react"
import stripAnsi from "strip-ansi"
import { useSession } from "../../context/session"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { useArrowKeyHistory } from "../../hooks/use-arrow-key-history"
import { useDoublePress } from "../../hooks/use-double-press"
import { usePasteHandler } from "../../hooks/use-paste-handler"
import type { BaseTextInputProps, PromptInputMode, VimMode } from "../../types/text-input"
import { TextInput } from "../text-input"
import VimTextInput from "../vim-text-input"
import { getModeFromInput, getValueFromInput } from "./input-modes"
import type { PastedContent } from "./input-paste"
import { maybeTruncateInput } from "./input-paste"
import { PromptInputFooter } from "./prompt-input-footer"
import { PromptInputModeIndicator } from "./prompt-input-mode-indicator"
import { isVimModeEnabled } from "./utils"

// ─── Constants ───────────────────────────────────────────────────────────────

/** Reserve lines for footer, border, etc. */
const PROMPT_FOOTER_LINES = 5
const MIN_INPUT_VIEWPORT_LINES = 3

// ─── Props ───────────────────────────────────────────────────────────────────

type PromptInputProps = {
  readonly debug: boolean
  readonly verbose: boolean
  readonly isLoading: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PromptInput({ debug, verbose, isLoading }: PromptInputProps) {
  const config = useTuiConfig()
  const session = useSession()
  const { theme } = useTheme()

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
  // TODO: wire loadEntries to session message history from sync store
  const noopLoader = useCallback(async function* (): AsyncGenerator<{
    display: string
    pastedContents?: Record<number, unknown>
  }> {
    // Placeholder: no history entries yet — future batch will wire this
    // to sync store session message history.
  }, [])

  const { onHistoryUp, onHistoryDown, resetHistory } = useArrowKeyHistory({
    onSetInput: (value: string) => {
      onChange(value)
    },
    currentInput: input,
    setCursorOffset,
    loadEntries: noopLoader,
  })

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
  const onSubmit = useCallback(
    async (inputParam: string) => {
      const trimmed = inputParam.trimEnd()
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
    [pastedContents, session, mode, trackAndSetInput, resetHistory],
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

  // ── Escape key handler ──────────────────────────────────────────────────
  useInput((_input, key) => {
    if (key.escape) {
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
    }

    if (key.return && exitMessage.show) {
      setExitMessage({ show: false })
    }
  })

  // ── Border color ────────────────────────────────────────────────────────
  const borderColor = useMemo((): Color => {
    if (mode === "bash") {
      return theme.warning as Color
    }
    return theme.border as Color
  }, [mode, theme])

  // ── Render ──────────────────────────────────────────────────────────────
  const baseProps: BaseTextInputProps = {
    multiline: true,
    onSubmit,
    onChange,
    value: input,
    onHistoryUp,
    onHistoryDown,
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
    focus: true,
    showCursor: true,
  }

  const textInputElement = isVimModeEnabled(config) ? (
    <VimTextInput {...baseProps} initialMode={vimMode} onModeChange={setVimMode} />
  ) : (
    <TextInput {...baseProps} />
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
      />
    </Box>
  )
}

export default PromptInput
