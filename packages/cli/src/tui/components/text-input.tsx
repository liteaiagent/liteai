/**
 * TextInput component
 *
 * Standard text input component that composes useTextInput with BaseTextInput.
 * Handles cursor inversion, theme integration, and terminal focus.
 *
 * Ported from MVP TextInput.tsx. Stripped:
 * - Voice mode waveform cursor (bun:bundle feature flag)
 * - useClipboardImageHint
 * - useSettings/reducedMotion
 * - useAnimationFrame
 * - hueToRgb
 * - isEnvTruthy accessibility check
 */

import { Box, TerminalSizeContext, useTerminalFocus } from "@liteai/ink"
import chalk from "chalk"
import type React from "react"
import { useContext, useState } from "react"
import { useTextInput } from "../hooks/use-text-input"
import type { BaseTextInputProps } from "../types/text-input"
import type { TextHighlight } from "../util/text-highlighting"
import { BaseTextInput } from "./base-text-input"

export type TextInputProps = Omit<BaseTextInputProps, "columns" | "cursorOffset" | "onChangeCursorOffset"> & {
  columns?: number
  cursorOffset?: number
  onChangeCursorOffset?: (offset: number) => void
  highlights?: TextHighlight[]
}

export function TextInput(props: TextInputProps): React.ReactNode {
  const isTerminalFocused = useTerminalFocus()
  const terminalSize = useContext(TerminalSizeContext)
  const [internalOffset, setInternalOffset] = useState(props.value.length)

  const columns = props.columns ?? terminalSize?.columns ?? 80
  const cursorOffset = props.cursorOffset ?? internalOffset
  const onChangeCursorOffset = props.onChangeCursorOffset ?? setInternalOffset

  // Cursor invert function: standard chalk.inverse when focused,
  // no-op when terminal is not focused.
  const invert: (text: string) => string = isTerminalFocused ? chalk.inverse : (text: string) => text

  const textInputState = useTextInput({
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
    columns,
    maxVisibleLines: props.maxVisibleLines,
    disableCursorMovementForUpDownKeys: props.disableCursorMovementForUpDownKeys,
    disableEscapeDoublePress: props.disableEscapeDoublePress,
    externalOffset: cursorOffset,
    onOffsetChange: onChangeCursorOffset,
    inputFilter: props.inputFilter,
    inlineGhostText: props.inlineGhostText,
    dim: chalk.dim,
    onTab: props.onTab,
  })

  return (
    <Box>
      <BaseTextInput
        inputState={textInputState}
        terminalFocus={isTerminalFocused}
        highlights={props.highlights}
        invert={invert}
        {...props}
        columns={columns}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={onChangeCursorOffset}
      />
    </Box>
  )
}

export default TextInput
