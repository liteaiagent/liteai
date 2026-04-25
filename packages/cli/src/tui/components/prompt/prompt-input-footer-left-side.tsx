/** @jsxImportSource react */
/**
 * Footer left-side component.
 * Adapted port from MVP `PromptInput/PromptInputFooterLeftSide.tsx`.
 *
 * Renders (left side of footer):
 * 1. Exit message — "Press X again to exit"
 * 2. "Pasting text…" indicator
 * 3. Vim `-- INSERT --` indicator
 * 4. Shortcut hint — "? for shortcuts" (when input is empty)
 * 5. "esc to interrupt" hint while loading
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

import { Box, Text } from "@liteai/ink"
import type { PromptInputMode, VimMode } from "../../types/text-input"
import { isVimModeEnabled } from "./utils"

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

function FooterHint({ mode, isLoading }: { mode: PromptInputMode; isLoading: boolean }) {
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
    <Text dim key="shortcuts-hint">
      ? for shortcuts
    </Text>
  )
}
