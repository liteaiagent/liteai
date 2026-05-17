/**
 * Footer left-side component.
 *
 * Renders (left side of footer below the input border):
 * 1. Exit message — "Press X again to exit"
 * 2. "Pasting text…" indicator
 * 3. Vim `-- INSERT --` indicator
 * 4. When loading: "esc to interrupt"
 * 5. When bash mode: "! for bash mode"
 * 6. Mode indicator (when non-default) + essential shortcuts
 *
 * Tip rotation has been extracted to `tip-banner.tsx` and renders above the prompt.
 *
 * @module components/prompt/prompt-input-footer-left-side
 */

import { Box, type Color, Text } from "@liteai/ink"
import { useTheme } from "../../context/theme"
import { useAppState } from "../../state"
import type { PromptInputMode, VimMode } from "../../types/text-input"
import {
  isDefaultMode,
  permissionModeColor,
  permissionModeSymbol,
  permissionModeTitle,
} from "../../util/permission-mode"
import { useExitState } from "../global-exit-handler"
import { isVimModeEnabled } from "./utils"

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
  readonly sessionID?: string
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
  sessionID,
}: PromptInputFooterLeftSideProps) {
  const globalExitState = useExitState()

  if (globalExitState.pending) {
    const keyName = globalExitState.keyName ?? "esc"
    return (
      <Text dim key="exit-message">
        Press {keyName.toLowerCase()} again to exit
      </Text>
    )
  }

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
    <Box justifyContent="flex-start" width="100%" gap={1}>
      {showVim ? (
        <Text dim key="vim-insert">
          -- INSERT --
        </Text>
      ) : null}

      {hint && <Box key="external-hint">{hint}</Box>}

      {!suppressHint && !showVim && <FooterHint mode={mode} isLoading={isLoading} sessionID={sessionID} />}
    </Box>
  )
}

// ── Footer hint: mode indicator + essential shortcuts ─────────────────────

function FooterHint({ mode, isLoading, sessionID }: { mode: PromptInputMode; isLoading: boolean; sessionID?: string }) {
  const { theme } = useTheme()
  const connected = useAppState((s) => s.provider_next.connected)
  const permMode = useAppState((s) => (sessionID ? (s.permissionMode[sessionID] ?? "default") : "default"))

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

  if (connected.length === 0) {
    return <Text color={theme.warning as Color}>No provider · Run /connect</Text>
  }

  return (
    <Box flexDirection="row" flexShrink={1} gap={1}>
      {/* Mode indicator pill — only shown for non-default modes */}
      {!isDefaultMode(permMode) && (
        <>
          <Text color={permissionModeColor(permMode) as Color}>
            {permissionModeSymbol(permMode)} {permissionModeTitle(permMode).toLowerCase()} on
          </Text>
          <Text dim>·</Text>
        </>
      )}
      {/* Persistent shortcut hints */}
      <Text dim>shift+tab modes · ? help · ctrl+p palette</Text>
    </Box>
  )
}
