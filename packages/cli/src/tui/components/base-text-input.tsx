/**
 * BaseTextInput component
 *
 * A base component for text inputs that handles rendering, cursor display,
 * placeholder rendering, and highlight overlays.
 *
 * Ported from MVP BaseTextInput.tsx. Dependency remappings:
 * - usePasteHandler → deferred (Sub-batch 3.1)
 * - useDeclaredCursor → simplified via useRef
 * - HighlightedInput → inline ANSI rendering
 */

// biome-ignore lint/style/noRestrictedImports: base-text-input is an exception — uses useInput directly as a low-level primitive
import { Ansi, Box, Text, useInput } from "@liteai/ink"
import type React from "react"
import { useTheme } from "../context/theme"
import { renderPlaceholder } from "../hooks/render-placeholder"
import type { BaseInputState, BaseTextInputProps } from "../types/text-input"
import { segmentTextByHighlights, type TextHighlight } from "../util/text-highlighting"

type BaseTextInputComponentProps = BaseTextInputProps & {
  inputState: BaseInputState
  children?: React.ReactNode
  terminalFocus: boolean
  highlights?: TextHighlight[]
  invert?: (text: string) => string
  hidePlaceholderText?: boolean
}

/**
 * A base component for text inputs that handles rendering and basic input
 */
export function BaseTextInput({
  inputState,
  children,
  terminalFocus,
  invert,
  hidePlaceholderText,
  ...props
}: BaseTextInputComponentProps): React.ReactNode {
  const { onInput, renderedValue } = inputState
  const { theme } = useTheme()

  // Register input handler — only active when focused
  useInput(
    (input, key) => {
      onInput(input, key)
    },
    { isActive: props.focus },
  )

  const { showPlaceholder, renderedPlaceholder } = renderPlaceholder({
    placeholder: props.placeholder,
    value: props.value,
    showCursor: props.showCursor,
    focus: props.focus,
    terminalFocus,
    invert,
    hidePlaceholderText,
  })

  // Show argument hint only when we have a command without arguments
  const commandWithoutArgs = (props.value && props.value.trim().indexOf(" ") === -1) || props.value?.endsWith(" ")
  const showArgumentHint = Boolean(
    props.argumentHint && props.value && commandWithoutArgs && props.value.startsWith("/"),
  )

  // Filter out highlights that contain the cursor position
  const cursorFiltered =
    props.showCursor && props.highlights
      ? props.highlights.filter((h) => h.dimColor || props.cursorOffset < h.start || props.cursorOffset >= h.end)
      : props.highlights

  // Adjust highlights for viewport windowing
  const { viewportCharOffset, viewportCharEnd } = inputState
  const filteredHighlights =
    cursorFiltered && viewportCharOffset > 0
      ? cursorFiltered
          .filter((h) => h.end > viewportCharOffset && h.start < viewportCharEnd)
          .map((h) => ({
            ...h,
            start: Math.max(0, h.start - viewportCharOffset),
            end: h.end - viewportCharOffset,
          }))
      : cursorFiltered

  const hasHighlights = filteredHighlights && filteredHighlights.length > 0

  const argumentHintElement = showArgumentHint ? (
    <Text dim>
      {props.value?.endsWith(" ") ? "" : " "}
      {props.argumentHint}
    </Text>
  ) : null

  if (hasHighlights) {
    const segments = segmentTextByHighlights(renderedValue, filteredHighlights ?? [])

    return (
      <Box>
        <Text wrap="truncate-end" dim={props.dimColor ?? false}>
          {segments.map((segment, index) => (
            <Text
              key={index}
              color={
                segment.highlight?.color ? (theme[segment.highlight.color] as import("@liteai/ink").Color) : undefined
              }
              dim={segment.highlight?.dimColor ?? false}
              inverse={segment.highlight?.inverse ?? false}
            >
              <Ansi>{segment.text}</Ansi>
            </Text>
          ))}
        </Text>
        {argumentHintElement}
        {children}
      </Box>
    )
  }

  return (
    <Box>
      <Text wrap="truncate-end" dim={props.dimColor ?? false}>
        {showPlaceholder && props.placeholderElement ? (
          props.placeholderElement
        ) : showPlaceholder && renderedPlaceholder ? (
          <Ansi>{renderedPlaceholder}</Ansi>
        ) : (
          <Ansi>{renderedValue}</Ansi>
        )}
        {argumentHintElement}
        {children}
      </Text>
    </Box>
  )
}
