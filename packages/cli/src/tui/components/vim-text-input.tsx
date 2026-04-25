/**
 * VimTextInput component
 *
 * Vim-enabled text input that composes useVimInput with BaseTextInput.
 * Extends TextInput with INSERT/NORMAL mode switching.
 *
 * Ported from MVP VimTextInput.tsx. Stripped:
 * - useClipboardImageHint
 * - useTheme/color (theme system)
 */

import { Box, useTerminalFocus } from "@liteai/ink"
import chalk from "chalk"
import type React from "react"
import { useVimInput } from "../hooks/use-vim-input"
import type { VimTextInputProps } from "../types/text-input"
import type { TextHighlight } from "../util/text-highlighting"
import { BaseTextInput } from "./base-text-input"

export type Props = VimTextInputProps & {
  highlights?: TextHighlight[]
}

export default function VimTextInput(props: Props): React.ReactNode {
  const isTerminalFocused = useTerminalFocus()

  const invert: (text: string) => string = isTerminalFocused ? chalk.inverse : (text: string) => text

  const vimInputState = useVimInput({
    value: props.value,
    onChange: props.onChange,
    onSubmit: props.onSubmit,
    onExit: props.onExit,
    onExitMessage: props.onExitMessage,
    onHistoryReset: props.onHistoryReset,
    onHistoryUp: props.onHistoryUp,
    onHistoryDown: props.onHistoryDown,
    onClearInput: props.onClearInput,
    focus: props.focus,
    mask: props.mask,
    multiline: props.multiline,
    cursorChar: props.showCursor ? " " : "",
    invert,
    themeText: chalk.white,
    columns: props.columns,
    maxVisibleLines: props.maxVisibleLines,
    disableCursorMovementForUpDownKeys: props.disableCursorMovementForUpDownKeys,
    disableEscapeDoublePress: props.disableEscapeDoublePress,
    externalOffset: props.cursorOffset,
    onOffsetChange: props.onChangeCursorOffset,
    inputFilter: props.inputFilter,
    inlineGhostText: props.inlineGhostText,
    dim: chalk.dim,
    onModeChange: props.onModeChange,
    onUndo: props.onUndo,
    onTab: props.onTab,
  })

  return (
    <Box>
      <BaseTextInput
        inputState={vimInputState}
        terminalFocus={isTerminalFocused}
        highlights={props.highlights}
        invert={invert}
        {...props}
      />
    </Box>
  )
}
