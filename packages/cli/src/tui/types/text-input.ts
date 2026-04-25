/**
 * Types for the text input system.
 * Ported from MVP textInputTypes.ts, adapted for the new TUI architecture.
 */

import type { Key } from "@liteai/ink"

/**
 * Inline ghost text for mid-input command autocomplete
 */
export type InlineGhostText = {
  /** The ghost text to display (e.g., "mit" for /commit) */
  readonly text: string
  /** The full command name (e.g., "commit") */
  readonly fullCommand: string
  /** Position in the input where the ghost text should appear */
  readonly insertPosition: number
}

/**
 * Base props for text input components
 */
export type BaseTextInputProps = {
  /**
   * Optional callback for handling history navigation on up arrow at start of input
   */
  readonly onHistoryUp?: () => void

  /**
   * Optional callback for handling history navigation on down arrow at end of input
   */
  readonly onHistoryDown?: () => void

  /**
   * Optional callback when Tab is pressed.
   * If provided and returns true, default Tab behavior is ignored.
   */
  readonly onTab?: () => void

  /**
   * Text to display when `value` is empty.
   */
  readonly placeholder?: string

  /**
   * Allow multi-line input via line ending with backslash (default: `true`)
   */
  readonly multiline?: boolean

  /**
   * Listen to user's input. Useful in case there are multiple input components
   * at the same time and input must be "routed" to a specific component.
   */
  readonly focus?: boolean

  /**
   * Replace all chars and mask the value. Useful for password inputs.
   */
  readonly mask?: string

  /**
   * Whether to show cursor and allow navigation inside text input with arrow keys.
   */
  readonly showCursor?: boolean

  /**
   * Highlight pasted text
   */
  readonly highlightPastedText?: boolean

  /**
   * Value to display in a text input.
   */
  readonly value: string

  /**
   * Function to call when value updates.
   */
  readonly onChange: (value: string) => void

  /**
   * Function to call when `Enter` is pressed, where first argument is a value of the input.
   */
  readonly onSubmit?: (value: string) => void

  /**
   * Function to call when Ctrl+C is pressed to exit.
   */
  readonly onExit?: () => void

  /**
   * Optional callback to show exit message
   */
  readonly onExitMessage?: (show: boolean, key?: string) => void

  /**
   * Optional callback to reset history position
   */
  readonly onHistoryReset?: () => void

  /**
   * Optional callback when input is cleared (e.g., double-escape)
   */
  readonly onClearInput?: () => void

  /**
   * Number of columns to wrap text at
   */
  readonly columns: number

  /**
   * Maximum visible lines for the input viewport. When the wrapped input
   * exceeds this many lines, only lines around the cursor are rendered.
   */
  readonly maxVisibleLines?: number

  /**
   * Optional callback when an image is pasted
   */
  readonly onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: { width: number; height: number },
    sourcePath?: string,
  ) => void

  /**
   * Optional callback when a large text (over 800 chars) is pasted
   */
  readonly onPaste?: (text: string) => void

  /**
   * Callback when the pasting state changes
   */
  readonly onIsPastingChange?: (isPasting: boolean) => void

  /**
   * Whether to disable cursor movement for up/down arrow keys
   */
  readonly disableCursorMovementForUpDownKeys?: boolean

  /**
   * Skip the text-level double-press escape handler. Set this when a
   * keybinding context (e.g. Autocomplete) owns escape.
   */
  readonly disableEscapeDoublePress?: boolean

  /**
   * The offset of the cursor within the text
   */
  readonly cursorOffset: number

  /**
   * Callback to set the offset of the cursor
   */
  onChangeCursorOffset: (offset: number) => void

  /**
   * Optional hint text to display after command input
   */
  readonly argumentHint?: string

  /**
   * Optional callback for undo functionality
   */
  readonly onUndo?: () => void

  /**
   * Whether to render the text with dim color
   */
  readonly dimColor?: boolean

  /**
   * Optional text highlights for search results or other highlighting
   */
  readonly highlights?: import("../util/text-highlighting").TextHighlight[]

  /**
   * Optional custom React element to render as placeholder.
   * When provided, overrides the standard `placeholder` string rendering.
   */
  readonly placeholderElement?: React.ReactNode

  /**
   * Optional inline ghost text for mid-input command autocomplete
   */
  readonly inlineGhostText?: InlineGhostText

  /**
   * Optional filter applied to raw input before key routing.
   */
  readonly inputFilter?: (input: string, key: Key) => string
}

/**
 * Extended props for VimTextInput
 */
export type VimTextInputProps = BaseTextInputProps & {
  /**
   * Initial vim mode to use
   */
  readonly initialMode?: VimMode

  /**
   * Optional callback for mode changes
   */
  readonly onModeChange?: (mode: VimMode) => void
}

/**
 * Vim editor modes
 */
export type VimMode = "INSERT" | "NORMAL"

/**
 * Common properties for input hook results
 */
export type BaseInputState = {
  onInput: (input: string, key: Key) => void
  renderedValue: string
  offset: number
  setOffset: (offset: number) => void
  /** Cursor line (0-indexed) within the rendered text, accounting for wrapping. */
  cursorLine: number
  /** Cursor column (display-width) within the current line. */
  cursorColumn: number
  /** Character offset in the full text where the viewport starts (0 when no windowing). */
  viewportCharOffset: number
  /** Character offset in the full text where the viewport ends (text.length when no windowing). */
  viewportCharEnd: number

  // For paste handling
  isPasting?: boolean
  pasteState?: {
    chunks: string[]
    timeoutId: ReturnType<typeof setTimeout> | null
  }
}

/**
 * State for text input
 */
export type TextInputState = BaseInputState

/**
 * State for vim input with mode
 */
export type VimInputState = BaseInputState & {
  mode: VimMode
  setMode: (mode: VimMode) => void
}

/**
 * Input modes for the prompt
 */
export type PromptInputMode = "bash" | "prompt"
