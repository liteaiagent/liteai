import type { Color } from "@liteai/ink"
import { Box } from "@liteai/ink"
import type React from "react"
import type { ThemeColors } from "../../context/theme.tsx"
import { useTheme } from "../../context/theme.tsx"

type BoxProps = React.ComponentProps<typeof Box>

// Color props that accept theme keys
type ThemedColorProps = {
  readonly borderColor?: keyof ThemeColors | Color
  readonly borderTopColor?: keyof ThemeColors | Color
  readonly borderBottomColor?: keyof ThemeColors | Color
  readonly borderLeftColor?: keyof ThemeColors | Color
  readonly borderRightColor?: keyof ThemeColors | Color
  readonly backgroundColor?: keyof ThemeColors | Color
  readonly key?: React.Key
}

export type Props = Omit<
  BoxProps,
  "borderColor" | "borderTopColor" | "borderBottomColor" | "borderLeftColor" | "borderRightColor" | "backgroundColor"
> &
  ThemedColorProps

/**
 * Resolves a color value that may be a theme key to a raw Color.
 */
function resolveColor(color: keyof ThemeColors | Color | undefined, theme: ThemeColors): Color | undefined {
  if (!color) return undefined
  // Check if it's a raw color (starts with rgb(, #, ansi256(, or ansi:)
  if (
    String(color).startsWith("rgb(") ||
    String(color).startsWith("#") ||
    String(color).startsWith("ansi256(") ||
    String(color).startsWith("ansi:")
  ) {
    return color as Color
  }
  // It's a theme key - resolve it
  return theme[color as keyof ThemeColors] as Color
}

/**
 * Theme-aware Box component that resolves theme color keys to raw colors.
 * This wraps the base Box component with theme resolution for border and background colors.
 */
function ThemedBox({
  borderColor,
  borderTopColor,
  borderBottomColor,
  borderLeftColor,
  borderRightColor,
  backgroundColor,
  children,
  ...rest
}: Props): React.ReactNode {
  const { theme } = useTheme()

  // Resolve theme keys to raw colors
  const resolvedBorderColor = resolveColor(borderColor, theme)
  const resolvedBorderTopColor = resolveColor(borderTopColor, theme)
  const resolvedBorderBottomColor = resolveColor(borderBottomColor, theme)
  const resolvedBorderLeftColor = resolveColor(borderLeftColor, theme)
  const resolvedBorderRightColor = resolveColor(borderRightColor, theme)
  const resolvedBackgroundColor = resolveColor(backgroundColor, theme)

  return (
    <Box
      borderColor={resolvedBorderColor}
      borderTopColor={resolvedBorderTopColor}
      borderBottomColor={resolvedBorderBottomColor}
      borderLeftColor={resolvedBorderLeftColor}
      borderRightColor={resolvedBorderRightColor}
      backgroundColor={resolvedBackgroundColor}
      {...(rest as unknown as BoxProps)}
    >
      {children}
    </Box>
  )
}

export default ThemedBox
