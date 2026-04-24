import { Ansi, stringWidth, TerminalSizeContext, Text } from "@liteai/ink"
import type React from "react"
import { useContext } from "react"
import type { ThemeColors } from "../../context/theme.tsx"
import ThemedText from "./ThemedText.tsx"

type DividerProps = {
  /**
   * Width of the divider in characters.
   * Defaults to terminal width.
   */
  width?: number

  /**
   * Theme color for the divider.
   * If not provided, dim is used.
   */
  color?: keyof ThemeColors

  /**
   * Character to use for the divider line.
   * @default '─'
   */
  char?: string

  /**
   * Padding to subtract from the width (e.g., for indentation).
   * @default 0
   */
  padding?: number

  /**
   * Title shown in the middle of the divider.
   * May contain ANSI codes (e.g., chalk-styled text).
   *
   * @example
   * // ─────────── Title ───────────
   * <Divider title="Title" />
   */
  title?: string
}

/**
 * A horizontal divider line.
 *
 * @example
 * // Full-width dimmed divider
 * <Divider />
 *
 * @example
 * // Colored divider
 * <Divider color="info" />
 *
 * @example
 * // Fixed width
 * <Divider width={40} />
 *
 * @example
 * // Full width minus padding (for indented content)
 * <Divider padding={4} />
 *
 * @example
 * // With centered title
 * <Divider title="3 new messages" />
 */
export function Divider({ width, color, char = "─", padding = 0, title }: DividerProps): React.ReactNode {
  const terminalSize = useContext(TerminalSizeContext)
  const terminalWidth = terminalSize?.columns ?? 80
  const effectiveWidth = Math.max(0, (width ?? terminalWidth) - padding)

  if (title) {
    const titleWidth = stringWidth(title) + 2 // +2 for spaces around title
    const sideWidth = Math.max(0, effectiveWidth - titleWidth)
    const leftWidth = Math.floor(sideWidth / 2)
    const rightWidth = sideWidth - leftWidth

    const content = (
      <>
        {char.repeat(leftWidth)}{" "}
        <Text dim>
          <Ansi>{title}</Ansi>
        </Text>{" "}
        {char.repeat(rightWidth)}
      </>
    )

    if (color) {
      return <ThemedText color={color}>{content}</ThemedText>
    }
    return <Text dim>{content}</Text>
  }

  if (color) {
    return <ThemedText color={color}>{char.repeat(effectiveWidth)}</ThemedText>
  }
  return <Text dim>{char.repeat(effectiveWidth)}</Text>
}
