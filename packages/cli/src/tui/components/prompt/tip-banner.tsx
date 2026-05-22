/**
 * TipBanner — rotating tip line rendered above the prompt input.
 *
 * When the agent is loading, shows an animated "Thinking… Xs" line with
 * elapsed time so the user always has clear visual feedback that work is
 * in progress. When idle, shows the rotating tip rotation.
 *
 * Hidden during cursor mode to keep the UI clean.
 *
 * @module components/prompt/tip-banner
 */

import { Box, type Color, Text } from "@liteai/ink"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTheme } from "../../context/theme"
import { useElapsedTime } from "../../hooks/use-elapsed-time"
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
  "Use [chat:commandPalette|Chat|ctrl+p] to open the command palette",
  "Use {highlight}/compact{/highlight} to summarize and compress the session",
  "Add {highlight}$schema{/highlight} to your config for autocomplete in your editor",
  "Press [history:search|Global|ctrl+r] to search history",
  "Press {highlight}esc{/highlight} twice to exit",
  "Run {highlight}/connect{/highlight} to connect a new AI provider",
  "Press [prompt:pasteImage|Prompt|alt+v] to paste images from your clipboard into the prompt",
  "Run {highlight}liteai upgrade{/highlight} to update to the latest version",
]

// ── Hooks ─────────────────────────────────────────────────────────────────────

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

// ── Working banner ────────────────────────────────────────────────────────────

/**
 * Tracks the wall-clock time when loading begins. Resets to null when idle
 * so the next loading phase starts a fresh counter.
 */
function useLoadingStartTime(isLoading: boolean): number | null {
  const startTimeRef = useRef<number | null>(null)

  if (isLoading && startTimeRef.current === null) {
    // Capture start time on the first render where loading becomes true.
    // Direct ref mutation during render is intentional here — it's a
    // synchronous capture that must happen before useElapsedTime reads it.
    startTimeRef.current = Date.now()
  } else if (!isLoading) {
    startTimeRef.current = null
  }

  return isLoading ? startTimeRef.current : null
}

function WorkingBanner({ startTime, agentName, modelID }: { startTime: number; agentName?: string; modelID?: string }) {
  const { theme } = useTheme()
  const { formatted } = useElapsedTime({ startTime, interval: 1000 })

  return (
    <Box flexDirection="row" flexShrink={1} gap={0} paddingLeft={1}>
      <Text color={theme.primary as Color}>⠿ </Text>
      {agentName ? (
        <>
          <Text color={theme.primary as Color}>{agentName}</Text>
          {modelID ? (
            <>
              <Text color={theme.textMuted as Color}> · </Text>
              <Text color={theme.textMuted as Color}>{modelID}</Text>
            </>
          ) : null}
        </>
      ) : (
        <Text color={theme.primary as Color}>Thinking</Text>
      )}
      <Text color={theme.textMuted as Color}>… {formatted}</Text>
    </Box>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

interface TipBannerProps {
  /** Whether the session is currently generating a response. */
  readonly isLoading: boolean
  /** Whether the message cursor is active (arrow-key navigation mode). */
  readonly cursorModeActive: boolean
  /** The name of the active agent. */
  readonly agentName?: string
  /** The ID of the active model. */
  readonly modelID?: string
}

/**
 * Single line above the prompt:
 * - While loading:      `⠿ Thinking… 3s`  — colored, elapsed time visible
 * - While idle:         `● Tip: Use ctrl+p to open…`
 * - During cursor mode: hidden
 */
export function TipBanner({ isLoading, cursorModeActive, agentName, modelID }: TipBannerProps) {
  const { theme } = useTheme()
  const tipParts = useTip()
  const startTime = useLoadingStartTime(isLoading)

  if (cursorModeActive) return null

  if (isLoading && startTime !== null) {
    return <WorkingBanner startTime={startTime} agentName={agentName} modelID={modelID} />
  }

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
