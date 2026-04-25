/**
 * useTextInput hook
 *
 * Core text input handling: cursor movement, editing, kill ring,
 * history navigation, and key mapping.
 *
 * Ported from MVP useTextInput.ts. Dependencies remapped:
 * - useNotifications → useToast
 * - addToHistory → inline history tracking
 * - isInputModeCharacter → deferred to Sub-batch 3.4
 * - env/modifiers → stripped (Apple_Terminal specifics)
 * - stripAnsi → direct import
 */

import type { Key } from "@liteai/ink"
import stripAnsi from "strip-ansi"
import type { InlineGhostText, TextInputState } from "../types/text-input"
import {
  Cursor,
  getLastKill,
  pushToKillRing,
  recordYank,
  resetKillAccumulation,
  resetYankState,
  updateYankLength,
  yankPop,
} from "../util/cursor"
import { useDoublePress } from "./use-double-press"

type MaybeCursor = undefined | Cursor
type InputHandler = (input: string) => MaybeCursor
type InputMapper = (input: string) => MaybeCursor
const NOOP_HANDLER: InputHandler = () => undefined

function mapInput(inputMap: Array<[string, InputHandler]>): InputMapper {
  const map = new Map(inputMap)
  return (input: string): MaybeCursor => (map.get(input) ?? NOOP_HANDLER)(input)
}

export type UseTextInputProps = {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  onExit?: () => void
  onExitMessage?: (show: boolean, key?: string) => void
  onHistoryUp?: () => void
  onHistoryDown?: () => void
  onHistoryReset?: () => void
  onClearInput?: () => void
  focus?: boolean
  mask?: string
  multiline?: boolean
  cursorChar: string
  invert: (text: string) => string
  themeText: (text: string) => string
  columns: number
  onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: { width: number; height: number },
    sourcePath?: string,
  ) => void
  disableCursorMovementForUpDownKeys?: boolean
  disableEscapeDoublePress?: boolean
  maxVisibleLines?: number
  externalOffset: number
  onOffsetChange: (offset: number) => void
  inputFilter?: (input: string, key: Key) => string
  inlineGhostText?: InlineGhostText
  dim?: (text: string) => string
  /** Optional toast notification for escape-to-clear messaging */
  showToast?: (message: string, durationMs?: number) => void
  /** Optional callback to add input to command history */
  addToHistory?: (value: string) => void
}

export function useTextInput({
  value: originalValue,
  onChange,
  onSubmit,
  onExit,
  onExitMessage,
  onHistoryUp,
  onHistoryDown,
  onHistoryReset,
  onClearInput,
  mask = "",
  multiline = false,
  cursorChar,
  invert,
  columns,
  disableCursorMovementForUpDownKeys = false,
  disableEscapeDoublePress = false,
  maxVisibleLines,
  externalOffset,
  onOffsetChange,
  inputFilter,
  inlineGhostText,
  dim,
  showToast,
  addToHistory,
}: UseTextInputProps): TextInputState {
  const offset = externalOffset
  const setOffset = onOffsetChange
  const cursor = Cursor.fromText(originalValue, columns, offset)

  const handleCtrlC = useDoublePress(
    (show) => {
      onExitMessage?.(show, "Ctrl-C")
    },
    () => onExit?.(),
    () => {
      if (originalValue) {
        onChange("")
        setOffset(0)
        onHistoryReset?.()
      }
    },
  )

  // NOTE(keybindings): This escape handler is intentionally NOT migrated to the keybindings system.
  // It's a text-level double-press escape for clearing input, not an action-level keybinding.
  // Double-press Esc clears the input and saves to history - this is text editing behavior,
  // not dialog dismissal, and needs the double-press safety mechanism.
  const handleEscape = useDoublePress(
    (show: boolean) => {
      if (!originalValue || !show) {
        return
      }
      showToast?.("Esc again to clear", 1000)
    },
    () => {
      onClearInput?.()
      if (originalValue) {
        // Save to history before clearing
        if (originalValue.trim() !== "") {
          addToHistory?.(originalValue)
        }
        onChange("")
        setOffset(0)
        onHistoryReset?.()
      }
    },
  )

  const handleEmptyCtrlD = useDoublePress(
    (show) => {
      if (originalValue !== "") {
        return
      }
      onExitMessage?.(show, "Ctrl-D")
    },
    () => {
      if (originalValue !== "") {
        return
      }
      onExit?.()
    },
  )

  function handleCtrlD(): MaybeCursor {
    if (cursor.text === "") {
      // When input is empty, handle double-press
      handleEmptyCtrlD()
      return cursor
    }
    // When input is not empty, delete forward like iPython
    return cursor.del()
  }

  function killToLineEnd(): Cursor {
    const { cursor: newCursor, killed } = cursor.deleteToLineEnd()
    pushToKillRing(killed, "append")
    return newCursor
  }

  function killToLineStart(): Cursor {
    const { cursor: newCursor, killed } = cursor.deleteToLineStart()
    pushToKillRing(killed, "prepend")
    return newCursor
  }

  function killWordBefore(): Cursor {
    const { cursor: newCursor, killed } = cursor.deleteWordBefore()
    pushToKillRing(killed, "prepend")
    return newCursor
  }

  function yank(): Cursor {
    const text = getLastKill()
    if (text.length > 0) {
      const startOffset = cursor.offset
      const newCursor = cursor.insert(text)
      recordYank(startOffset, text.length)
      return newCursor
    }
    return cursor
  }

  function handleYankPop(): Cursor {
    const popResult = yankPop()
    if (!popResult) {
      return cursor
    }
    const { text, start, length } = popResult
    // Replace the previously yanked text with the new one
    const before = cursor.text.slice(0, start)
    const after = cursor.text.slice(start + length)
    const newText = before + text + after
    const newOffset = start + text.length
    updateYankLength(text.length)
    return Cursor.fromText(newText, columns, newOffset)
  }

  const handleCtrl = mapInput([
    ["a", () => cursor.startOfLine()],
    ["b", () => cursor.left()],
    [
      "c",
      () => {
        handleCtrlC()
        return undefined
      },
    ],
    ["d", handleCtrlD],
    ["e", () => cursor.endOfLine()],
    ["f", () => cursor.right()],
    ["h", () => cursor.deleteTokenBefore() ?? cursor.backspace()],
    ["k", killToLineEnd],
    ["n", () => downOrHistoryDown()],
    ["p", () => upOrHistoryUp()],
    ["u", killToLineStart],
    ["w", killWordBefore],
    ["y", yank],
  ])

  const handleMeta = mapInput([
    ["b", () => cursor.prevWord()],
    ["f", () => cursor.nextWord()],
    ["d", () => cursor.deleteWordAfter()],
    ["y", handleYankPop],
  ])

  function handleEnter(key: Key) {
    if (multiline && cursor.offset > 0 && cursor.text[cursor.offset - 1] === "\\") {
      return cursor.backspace().insert("\n")
    }
    // Meta+Enter or Shift+Enter inserts a newline
    if (key.meta || key.shift) {
      return cursor.insert("\n")
    }
    onSubmit?.(originalValue)
  }

  function upOrHistoryUp() {
    if (disableCursorMovementForUpDownKeys) {
      onHistoryUp?.()
      return cursor
    }
    // Try to move by wrapped lines first
    const cursorUp = cursor.up()
    if (!cursorUp.equals(cursor)) {
      return cursorUp
    }

    // If we can't move by wrapped lines and this is multiline input,
    // try to move by logical lines (to handle paragraph boundaries)
    if (multiline) {
      const cursorUpLogical = cursor.upLogicalLine()
      if (!cursorUpLogical.equals(cursor)) {
        return cursorUpLogical
      }
    }

    // Can't move up at all - trigger history navigation
    onHistoryUp?.()
    return cursor
  }

  function downOrHistoryDown() {
    if (disableCursorMovementForUpDownKeys) {
      onHistoryDown?.()
      return cursor
    }
    // Try to move by wrapped lines first
    const cursorDown = cursor.down()
    if (!cursorDown.equals(cursor)) {
      return cursorDown
    }

    // If we can't move by wrapped lines and this is multiline input,
    // try to move by logical lines (to handle paragraph boundaries)
    if (multiline) {
      const cursorDownLogical = cursor.downLogicalLine()
      if (!cursorDownLogical.equals(cursor)) {
        return cursorDownLogical
      }
    }

    // Can't move down at all - trigger history navigation
    onHistoryDown?.()
    return cursor
  }

  function mapKey(key: Key): InputMapper {
    switch (true) {
      case key.escape:
        return () => {
          if (disableEscapeDoublePress) return cursor
          handleEscape()
          return cursor
        }
      case key.leftArrow && (key.ctrl || key.meta || key.fn):
        return () => cursor.prevWord()
      case key.rightArrow && (key.ctrl || key.meta || key.fn):
        return () => cursor.nextWord()
      case key.backspace:
        return key.meta || key.ctrl ? killWordBefore : () => cursor.deleteTokenBefore() ?? cursor.backspace()
      case key.delete:
        return key.meta ? killToLineEnd : () => cursor.del()
      case key.ctrl:
        return handleCtrl
      case key.home:
        return () => cursor.startOfLine()
      case key.end:
        return () => cursor.endOfLine()
      case key.pageDown:
        return () => cursor.endOfLine()
      case key.pageUp:
        return () => cursor.startOfLine()
      case key.wheelUp:
      case key.wheelDown:
        return NOOP_HANDLER
      case key.return:
        return () => handleEnter(key)
      case key.meta:
        return handleMeta
      case key.tab:
        return () => cursor
      case key.upArrow && !key.shift:
        return upOrHistoryUp
      case key.downArrow && !key.shift:
        return downOrHistoryDown
      case key.leftArrow:
        return () => cursor.left()
      case key.rightArrow:
        return () => cursor.right()
      default: {
        return (input: string) => {
          switch (true) {
            // Home key
            case input === "\x1b[H" || input === "\x1b[1~":
              return cursor.startOfLine()
            // End key
            case input === "\x1b[F" || input === "\x1b[4~":
              return cursor.endOfLine()
            default: {
              const text = stripAnsi(input)
                .replace(/(?<=[^\\\r\n])\r$/, "")
                .replace(/\r/g, "\n")
              return cursor.insert(text)
            }
          }
        }
      }
    }
  }

  // Check if this is a kill command (Ctrl+K, Ctrl+U, Ctrl+W, or Meta+Backspace/Delete)
  function isKillKey(key: Key, input: string): boolean {
    if (key.ctrl && (input === "k" || input === "u" || input === "w")) {
      return true
    }
    if (key.meta && (key.backspace || key.delete)) {
      return true
    }
    return false
  }

  // Check if this is a yank command (Ctrl+Y or Alt+Y)
  function isYankKey(key: Key, input: string): boolean {
    return (key.ctrl || key.meta) && input === "y"
  }

  function onInput(input: string, key: Key): void {
    // Apply filter if provided
    const filteredInput = inputFilter ? inputFilter(input, key) : input

    // If the input was filtered out, do nothing
    if (filteredInput === "" && input !== "") {
      return
    }

    // Fix Issue #1853: Filter DEL characters that interfere with backspace in SSH/tmux
    if (!key.backspace && !key.delete && input.includes("\x7f")) {
      const delCount = (input.match(/\x7f/g) || []).length

      let currentCursor = cursor
      for (let i = 0; i < delCount; i++) {
        currentCursor = currentCursor.deleteTokenBefore() ?? currentCursor.backspace()
      }

      if (!cursor.equals(currentCursor)) {
        if (cursor.text !== currentCursor.text) {
          onChange(currentCursor.text)
        }
        setOffset(currentCursor.offset)
      }
      resetKillAccumulation()
      resetYankState()
      return
    }

    // Reset kill accumulation for non-kill keys
    if (!isKillKey(key, filteredInput)) {
      resetKillAccumulation()
    }

    // Reset yank state for non-yank keys (breaks yank-pop chain)
    if (!isYankKey(key, filteredInput)) {
      resetYankState()
    }

    const nextCursor = mapKey(key)(filteredInput)
    if (nextCursor) {
      if (!cursor.equals(nextCursor)) {
        if (cursor.text !== nextCursor.text) {
          onChange(nextCursor.text)
        }
        setOffset(nextCursor.offset)
      }
      // SSH-coalesced Enter handling
      if (
        filteredInput.length > 1 &&
        filteredInput.endsWith("\r") &&
        !filteredInput.slice(0, -1).includes("\r") &&
        filteredInput[filteredInput.length - 2] !== "\\"
      ) {
        onSubmit?.(nextCursor.text)
      }
    }
  }

  // Prepare ghost text for rendering
  const ghostTextForRender =
    inlineGhostText && dim && inlineGhostText.insertPosition === offset
      ? { text: inlineGhostText.text, dim }
      : undefined

  const cursorPos = cursor.getPosition()

  return {
    onInput,
    renderedValue: cursor.render(cursorChar, mask, invert, ghostTextForRender, maxVisibleLines),
    offset,
    setOffset,
    cursorLine: cursorPos.line - cursor.getViewportStartLine(maxVisibleLines),
    cursorColumn: cursorPos.column,
    viewportCharOffset: cursor.getViewportCharOffset(maxVisibleLines),
    viewportCharEnd: cursor.getViewportCharEnd(maxVisibleLines),
  }
}
