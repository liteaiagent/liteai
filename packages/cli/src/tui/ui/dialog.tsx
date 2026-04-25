import type { ScrollBoxHandle } from "@liteai/ink"
import { Box, Text, useInput } from "@liteai/ink"
import React, { createContext, type RefObject, useContext } from "react"
import { Byline } from "../components/design-system/Byline"
import { KeyboardShortcutHint } from "../components/design-system/KeyboardShortcutHint"
import { Pane } from "../components/design-system/Pane"
import { useKeybind } from "../context/keybind"
import type { ThemeColors } from "../context/theme.tsx"

// --- Modal Context ---
type ModalCtx = {
  rows: number
  columns: number
  scrollRef: RefObject<ScrollBoxHandle> | null
}
export const ModalContext = createContext<ModalCtx | null>(null)

export function useIsInsideModal(): boolean {
  return useContext(ModalContext) !== null
}

export function useModalOrTerminalSize(fallback: { rows: number; columns: number }): { rows: number; columns: number } {
  const ctx = useContext(ModalContext)
  return ctx ? { rows: ctx.rows, columns: ctx.columns } : fallback
}

export function useModalScrollRef(): RefObject<ScrollBoxHandle> | null {
  return useContext(ModalContext)?.scrollRef ?? null
}

// --- Dialog Primitive ---
type DialogProps = {
  title: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  onCancel?: () => void
  color?: keyof ThemeColors
  hideInputGuide?: boolean
  hideBorder?: boolean
  inputGuide?: React.ReactNode
  isCancelActive?: boolean
}

export function Dialog({
  title,
  subtitle,
  children,
  onCancel,
  color = "info",
  hideInputGuide,
  hideBorder,
  inputGuide,
  isCancelActive = true,
}: DialogProps): React.ReactNode {
  const keybind = useKeybind()

  useInput((_input, _key, event) => {
    if (!isCancelActive || !onCancel || !event) return
    if (keybind.match("cancel", event.keypress) || keybind.match("escape", event.keypress)) {
      onCancel()
    }
  })

  const defaultInputGuide = (
    <Byline>
      <KeyboardShortcutHint shortcut="Enter" action="confirm" />
      <KeyboardShortcutHint shortcut="Esc" action="cancel" />
    </Byline>
  )

  const content = (
    <>
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text color="ansi:white" bold>
            {title}
          </Text>
          {subtitle && <Text dim>{subtitle}</Text>}
        </Box>
        {children}
      </Box>
      {!hideInputGuide && (
        <Box marginTop={1}>
          <Text dim>{inputGuide ? inputGuide : defaultInputGuide}</Text>
        </Box>
      )}
    </>
  )

  if (hideBorder) {
    return content
  }

  return <Pane color={color}>{content}</Pane>
}
