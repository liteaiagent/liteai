import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type React from "react"
import { useTheme } from "../context/theme"
import type { DialogPaneProps } from "./types"

/**
 * Standard visual wrapper for all dialog primitives.
 *
 * Renders a bordered pane with a title header and an optional footer.
 * The footer can be either custom JSX (`footer`) or an auto-rendered
 * hint bar (`footerHints`). If both are provided, `footer` takes precedence.
 *
 * @example
 * ```tsx
 * <DialogPane
 *   title="Select Model"
 *   footerHints={[
 *     { key: "enter", label: "select" },
 *     { key: "esc", label: "close" },
 *   ]}
 * >
 *   <SelectList ... />
 * </DialogPane>
 * ```
 */
export function DialogPane({ title, children, footer, footerHints }: DialogPaneProps): React.ReactNode {
  const { theme } = useTheme()

  const resolvedFooter =
    footer ?? (footerHints && footerHints.length > 0 ? <FooterHintBar hints={footerHints} /> : null)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border as Color} paddingX={1}>
      {/* Title header */}
      <Box paddingBottom={1}>
        <Text bold color={theme.text as Color}>
          {title}
        </Text>
      </Box>

      {/* Content */}
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>

      {/* Footer */}
      {resolvedFooter && <Box paddingTop={1}>{resolvedFooter}</Box>}
    </Box>
  )
}

/**
 * Auto-rendered footer hint bar from `FooterHint[]`.
 */
function FooterHintBar({ hints }: { hints: NonNullable<DialogPaneProps["footerHints"]> }): React.ReactNode {
  const { theme } = useTheme()

  return (
    <Box gap={2}>
      {hints.map((hint) => (
        <Box key={hint.key} gap={1}>
          <Text bold color={theme.accent as Color}>
            {hint.key}
          </Text>
          <Text color={theme.textMuted as Color}>{hint.label}</Text>
        </Box>
      ))}
    </Box>
  )
}
