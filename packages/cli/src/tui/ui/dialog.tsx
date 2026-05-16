/**
 * Dialog — a confirm/cancel overlay wrapper.
 *
 * Renders title + children inside a Pane (bordered region), registers
 * `confirm:no` (Escape) in the Confirmation keybinding context, and shows
 * a default Enter/Esc hint footer.
 *
 * For plain info dialogs with no confirm/cancel semantics (e.g. /help,
 * /diff, /context) use `<Pane>` directly and manage your own keybindings.
 */

import { Box, Text } from "@liteai/ink"
import type React from "react"
import { Byline } from "../components/design-system/Byline"
import { KeyboardShortcutHint } from "../components/design-system/KeyboardShortcutHint"
import { Pane } from "../components/design-system/Pane"
import type { ThemeColors } from "../context/theme.tsx"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybinding } from "../keybindings/use-keybinding"

// Re-export modal context hooks for backward compatibility with any remaining
// consumers that import from this path. The canonical source is context/modal-context.
export { ModalContext, useIsInsideModal, useModalOrTerminalSize, useModalScrollRef } from "../context/modal-context"

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
  useRegisterKeybindingContext("Confirmation", isCancelActive && !!onCancel)
  useKeybinding(
    "confirm:no",
    () => {
      onCancel?.()
    },
    { context: "Confirmation", isActive: isCancelActive && !!onCancel },
  )

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
