/**
 * TipBanner — rotating tip line rendered above the prompt input.
 *
 * Extracted from `prompt-input-footer-left-side.tsx` so the tip has its own
 * dedicated line above the prompt border, making it visible without consuming
 * space inside the footer (which now shows the mode indicator + shortcuts).
 *
 * Only renders when idle: hidden during loading, cursor mode, and search.
 *
 * @module components/prompt/tip-banner
 */

import { Box, type Color, Text } from "@liteai/ink"
import { useEffect, useMemo, useState } from "react"
import { useTheme } from "../../context/theme"
import { useKeybindingContext } from "../../keybindings/keybinding-context"

// ── Tip parsing ──────────────────────────────────────────────────────────────

type TipPart = { text: string; highlight: boolean }

function parseTip(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const matches = Array.from(tip.matchAll(regex))
  let lastIndex = 0
  for (const match of matches) {
    const start = match.index ?? 0
    if (start > lastIndex) parts.push({ text: tip.slice(lastIndex, start), highlight: false })
    parts.push({ text: match[1], highlight: true })
    lastIndex = start + match[0].length
  }
  if (lastIndex < tip.length) parts.push({ text: tip.slice(lastIndex), highlight: false })
  return parts
}

// ── Tip pool ─────────────────────────────────────────────────────────────────

/** Small curated subset — avoids duplicating the full list from tips.tsx */
const TIPS_SUBSET = [
  "Use {highlight}ctrl+p{/highlight} to open the command palette",
  "Use {highlight}/compact{/highlight} to summarize and compress the session",
  "Add {highlight}$schema{/highlight} to your config for autocomplete in your editor",
  "Press {highlight}ctrl+r{/highlight} to search history",
  "Press {highlight}esc{/highlight} twice to exit",
  "Run {highlight}/connect{/highlight} to connect a new AI provider",
  "Press {highlight}alt+v{/highlight} to paste images from your clipboard into the prompt",
  "Run {highlight}liteai upgrade{/highlight} to update to the latest version",
]

// ── Hook ─────────────────────────────────────────────────────────────────────

function useTip() {
  const { getDisplayText } = useKeybindingContext()
  const tips = useMemo(() => {
    return TIPS_SUBSET.map((tip) =>
      tip.replace(/\[([^|]+)\|([^|]+)\|([^\]]+)\]/g, (_match, action, context, fallback) => {
        const display = getDisplayText(action, context)
        return `{highlight}${display || fallback}{/highlight}`
      }),
    )
  }, [getDisplayText])

  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * tips.length))
  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((prev) => {
        let next: number
        do {
          next = Math.floor(Math.random() * tips.length)
        } while (next === prev && tips.length > 1)
        return next
      })
    }, 30_000)
    return () => clearInterval(interval)
  }, [tips.length])

  return useMemo(() => parseTip(tips[tipIndex] ?? tips[0]), [tips, tipIndex])
}

// ── Component ────────────────────────────────────────────────────────────────

interface TipBannerProps {
  /** Whether the session is currently generating a response. */
  readonly isLoading: boolean
  /** Whether the message cursor is active (arrow-key navigation mode). */
  readonly cursorModeActive: boolean
}

/**
 * Single dim line above the prompt: `● Tip: Use ctrl+p to open…`
 * Hidden during loading and cursor mode to keep the UI clean.
 */
export function TipBanner({ isLoading, cursorModeActive }: TipBannerProps) {
  const { theme } = useTheme()
  const tipParts = useTip()

  if (isLoading || cursorModeActive) return null

  return (
    <Box flexDirection="row" flexShrink={1} gap={0} paddingLeft={1}>
      <Text color={theme.warning as Color}>● </Text>
      <Text color={theme.textMuted as Color}>Tip </Text>
      {tipParts.map((part, i) => (
        <Text
          key={i}
          color={(part.highlight ? theme.text : theme.textMuted) as Color}
          wrap={i === tipParts.length - 1 ? "truncate" : undefined}
        >
          {part.text}
        </Text>
      ))}
    </Box>
  )
}
