import type { Color } from "@liteai/ink"
import { Text } from "@liteai/ink"
import type React from "react"
import type { ThemeColors } from "../../context/theme.tsx"
import { useTheme } from "../../context/theme.tsx"

type TextProps = React.ComponentProps<typeof Text>

type ThemedColorProps = {
  readonly color?: keyof ThemeColors | Color
  readonly backgroundColor?: keyof ThemeColors | Color
  readonly key?: React.Key
}

export type Props = Omit<TextProps, "color" | "backgroundColor"> & ThemedColorProps

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
 * Theme-aware Text component that resolves theme color keys to raw colors.
 * This wraps the base Text component with theme resolution.
 */
function ThemedText({ color, backgroundColor, children, ...rest }: Props): React.ReactNode {
  const { theme } = useTheme()

  // Resolve theme keys to raw colors
  const resolvedColor = resolveColor(color, theme)
  const resolvedBackgroundColor = resolveColor(backgroundColor, theme)

  return (
    <Text color={resolvedColor} backgroundColor={resolvedBackgroundColor} {...(rest as unknown as TextProps)}>
      {children}
    </Text>
  )
}

export default ThemedText
