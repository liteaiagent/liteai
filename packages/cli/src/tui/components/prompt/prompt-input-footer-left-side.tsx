/**
 * Footer left-side component.
 * Adapted port from MVP `PromptInput/PromptInputFooterLeftSide.tsx`.
 *
 * Renders (left side of footer):
 * 1. Exit message — "Press X again to exit"
 * 2. "Pasting text…" indicator
 * 3. Vim `-- INSERT --` indicator
 * 4. When loading: "esc to interrupt"
 * 5. When bash mode: "! for bash mode"
 * 6. Default idle state: "? for shortcuts · ctrl+p palette | ● Tip: [rotating tip]"
 *
 * Stripped:
 * - React Compiler artifacts (_c(), $[n])
 * - BackgroundTaskStatus / Coordinator / Agent swarm pills
 * - TeamStatus / TeamsDialog
 * - ProactiveCountdown
 * - Remote session indicator
 * - PR badge
 * - Voice warmup hint
 * - Selection hints (fullscreen)
 * - Tungsten/tmux pill
 * - Permission mode cycling with auto-mode opt-in
 */

import { Box, type Color, Text } from "@liteai/ink"
import { useEffect, useMemo, useState } from "react"
import { useTheme } from "../../context/theme"
import { useKeybindingContext } from "../../keybindings/keybinding-context"
import type { PromptInputMode, VimMode } from "../../types/text-input"
import { isVimModeEnabled } from "./utils"

// ── Tip rotation (same pool as the old Tips component) ─────────────────────

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

/** Small curated subset — avoids duplicating the full list from tips.tsx */
const TIPS_SUBSET = [
  "Press {highlight}?{/highlight} to view all keyboard shortcuts",
  "Use {highlight}ctrl+p{/highlight} to open the command palette",
  "Use {highlight}/compact{/highlight} to summarize and compress the session",
  "Add {highlight}$schema{/highlight} to your config for autocomplete in your editor",
  "Press {highlight}ctrl+r{/highlight} to search history",
  "Press {highlight}esc{/highlight} twice to exit",
  "Run {highlight}/connect{/highlight} to connect a new AI provider",
  "Press {highlight}alt+v{/highlight} to paste images from your clipboard into the prompt",
  "Run {highlight}liteai upgrade{/highlight} to update to the latest version",
]

// ── Props ────────────────────────────────────────────────────────────────────

type PromptInputFooterLeftSideProps = {
  readonly exitMessage: { show: boolean; key?: string }
  readonly vimMode: VimMode | undefined
  readonly mode: PromptInputMode
  readonly suppressHint: boolean
  readonly isLoading: boolean
  readonly isPasting?: boolean
  readonly config: Record<string, unknown>
  readonly hint?: React.ReactNode
}

// ── Component ────────────────────────────────────────────────────────────────

export function PromptInputFooterLeftSide({
  exitMessage,
  vimMode,
  mode,
  suppressHint,
  isLoading,
  isPasting,
  config,
  hint,
}: PromptInputFooterLeftSideProps) {
  if (exitMessage.show) {
    return (
      <Text dim key="exit-message">
        Press {exitMessage.key} again to exit
      </Text>
    )
  }

  if (isPasting) {
    return (
      <Text dim key="pasting-message">
        Pasting text…
      </Text>
    )
  }

  const showVim = isVimModeEnabled(config) && vimMode === "INSERT"

  return (
    <Box justifyContent="flex-start" gap={1}>
      {showVim ? (
        <Text dim key="vim-insert">
          -- INSERT --
        </Text>
      ) : null}

      {hint && <Box key="external-hint">{hint}</Box>}

      {!suppressHint && !showVim && <FooterHint mode={mode} isLoading={isLoading} />}
    </Box>
  )
}

// ── Footer hint: idle state shows shortcuts + rotating tip ───────────────────

function FooterHint({ mode, isLoading }: { mode: PromptInputMode; isLoading: boolean }) {
  const tipParts = useTip()
  const { theme } = useTheme()

  if (mode === "bash") {
    return <Text dim>! for bash mode</Text>
  }

  if (isLoading) {
    return (
      <Text dim key="esc">
        esc to interrupt
      </Text>
    )
  }

  return (
    <Box flexDirection="row" flexShrink={1} gap={0}>
      <Text dim>? for shortcuts · ctrl+p palette</Text>
      <Text color={theme.textMuted as Color}>{" | "}</Text>
      <Text color={theme.warning as Color}>● </Text>
      <Text color={theme.textMuted as Color}>Tip </Text>
      {tipParts.map((part, i) => (
        <Text key={i} color={(part.highlight ? theme.text : theme.textMuted) as Color} wrap="truncate">
          {part.text}
        </Text>
      ))}
    </Box>
  )
}
