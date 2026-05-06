import { Box, TerminalSizeContext } from "@liteai/ink"
import type React from "react"
import { useContext } from "react"
import { DialogContext } from "../../context/dialog.tsx"
import type { ThemeColors } from "../../context/theme.tsx"
import { useIsInsideModal } from "../../ui/dialog.tsx"
import { Divider } from "./Divider.tsx"

type PaneProps = {
  children: React.ReactNode
  /**
   * Theme color for the top border line.
   */
  color?: keyof ThemeColors
}

/**
 * A pane — a region of the terminal that appears below the REPL prompt,
 * bounded by a colored top line with a one-row gap above and horizontal
 * padding. Used by all slash-command screens: /config, /help, /plugins,
 * /sandbox, /stats, /permissions.
 *
 * For confirm/cancel dialogs (Esc to dismiss, Enter to confirm), use
 * `<Dialog>` instead — it registers its own keybindings. For a full
 * rounded-border card, use `<Panel>`.
 *
 * Submenus rendered inside a Pane should use `hideBorder` on their Dialog
 * so the Pane's border remains the single frame.
 *
 * @example
 * <Pane color="permission">
 *   <Tabs title="Sandbox:">...</Tabs>
 * </Pane>
 */
export function Pane({ children, color }: PaneProps): React.ReactNode {
  // When rendered inside FullscreenLayout's modal slot, its ▔ divider IS
  // the frame. Skip our own Divider (would double-frame) and the extra top
  // padding. This lets slash-command screens that wrap in Pane (e.g.
  // /model → ModelPicker) route through the modal slot unchanged.
  if (useIsInsideModal()) {
    // flexShrink=0: the modal slot's absolute Box has no explicit height
    // (grows to fit, maxHeight cap). With flexGrow=1, re-renders cause
    // yoga to resolve this Box's height to 0 against the undetermined
    // parent — /permissions body blanks on Down arrow. See #23592.
    return (
      <Box flexDirection="column" paddingX={1} flexShrink={0}>
        {children}
      </Box>
    )
  }
  const dialogCtx = useContext(DialogContext)
  const terminalSize = useContext(TerminalSizeContext)
  const currentColumns = terminalSize?.columns ?? 80

  // If inside a DialogProvider, the actual box is constrained.
  // The max width of a dialog is currentColumns - 2.
  const dialogWidth = dialogCtx
    ? Math.min(dialogCtx.size === "large" ? 80 : 60, Math.max(0, currentColumns - 2))
    : undefined

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Divider color={color} width={dialogWidth} />
      <Box flexDirection="column" paddingX={2}>
        {children}
      </Box>
    </Box>
  )
}
