import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type React from "react"
import { logo, marks } from "../../cli/logo"
import { useTheme } from "../context/theme.tsx"

const SHADOW_MARKER = new RegExp(`[${marks}]`)

export function Logo() {
  const { theme } = useTheme()

  const renderLine = (line: string, fg: string, bold: boolean): React.ReactNode[] => {
    // In Ink, we can't easily do 'tint' for background if we don't have a helper.
    // I'll skip the shadow background for now or use a simple muted color if available.
    // Actually, the legacy code used tint(theme.background, fg, 0.25).
    // For now I'll just render it as text.

    const elements: React.ReactNode[] = []
    let i = 0

    while (i < line.length) {
      const rest = line.slice(i)
      const markerIndex = rest.search(SHADOW_MARKER)

      if (markerIndex === -1) {
        elements.push(
          // @ts-expect-error: key prop handled by React
          <Text key={i} color={fg as Color} bold={bold}>
            {rest}
          </Text>,
        )
        break
      }

      if (markerIndex > 0) {
        elements.push(
          // @ts-expect-error: key prop handled by React
          <Text key={i} color={fg as Color} bold={bold}>
            {rest.slice(0, markerIndex)}
          </Text>,
        )
      }

      const marker = rest[markerIndex]
      switch (marker) {
        case "_":
          elements.push(
            // @ts-expect-error: key prop handled by React
            <Text key={`${i}m`} color={fg as Color} backgroundColor={theme.backgroundElement as Color} bold={bold}>
              {" "}
            </Text>,
          )
          break
        case "^":
          elements.push(
            // @ts-expect-error: key prop handled by React
            <Text key={`${i}m`} color={fg as Color} backgroundColor={theme.backgroundElement as Color} bold={bold}>
              ▀
            </Text>,
          )
          break
        case "~":
          elements.push(
            // @ts-expect-error: key prop handled by React
            <Text key={`${i}m`} color={theme.textMuted as Color} bold={bold}>
              ▀
            </Text>,
          )
          break
      }

      i += markerIndex + 1
    }

    return elements
  }

  return (
    <Box flexDirection="column">
      {logo.left.map((line, index) => (
        // @ts-expect-error: key prop handled by React
        <Box key={index} flexDirection="row" gap={1}>
          <Box flexDirection="row">{renderLine(line, theme.textMuted, false)}</Box>
          <Box flexDirection="row">{renderLine(logo.right[index], theme.text, true)}</Box>
        </Box>
      ))}
    </Box>
  )
}
