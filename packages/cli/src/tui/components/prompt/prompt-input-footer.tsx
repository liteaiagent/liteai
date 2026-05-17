/**
 * Prompt input footer — the row below the text input.
 * Adapted port from MVP `PromptInput/PromptInputFooter.tsx`.
 *
 * Layout (horizontal):
 * ┌──────────────────────────────────────────────────────────┐
 * │ [FooterLeftSide]                         [Notifications] │
 * └──────────────────────────────────────────────────────────┘
 *
 * Slash stall fix: we always render the same component tree structure.
 * When suggestions are active we render PromptCommandSuggestions *instead of*
 * PromptInputFooterLeftSide in the left slot — but via conditional content
 * inside a stable Box, not by swapping the Box itself out. This prevents Ink
 * from doing a full subtree unmount/remount which caused the one-frame visual
 * stall when clearing a "/" input.
 *
 * Stripped:
 * - AutocompleteFooterSuggestions overlay (tab completion)
 * - PromptInputHelpMenu
 * - StatusLine (custom user status)
 * - CoordinatorTaskPanel
 * - BridgeStatusIndicator
 * - Agent swarm integration
 * - Fullscreen overlay portal
 * - React Compiler artifacts (_c(), $[n])
 */

import { Box, TerminalSizeContext } from "@liteai/ink"
import { useContext, useMemo } from "react"
import type { PromptInputMode, VimMode } from "../../types/text-input"
import { HistorySearchInput } from "./history-search-input"
import { Notifications } from "./notifications"
import { PromptCommandSuggestions } from "./prompt-command-suggestions"
import { PromptInputFooterLeftSide } from "./prompt-input-footer-left-side"
import type { SuggestionItem } from "./utils/types"

type PromptInputFooterProps = {
  readonly debug: boolean
  readonly verbose: boolean
  readonly exitMessage: { show: boolean; key?: string }
  readonly vimMode: VimMode | undefined
  readonly mode: PromptInputMode
  readonly isLoading: boolean
  readonly isPasting?: boolean
  readonly isInputWrapped?: boolean
  readonly config: Record<string, unknown>
  readonly searchState?: {
    isSearching: boolean
    query: string
    setQuery: (q: string) => void
    hasFailedMatch: boolean
  }
  readonly hint?: React.ReactNode
  readonly commandSuggestions?: SuggestionItem[]
  readonly commandSelectedIndex?: number
  readonly atSuggestions?: SuggestionItem[]
  readonly atSelectedIndex?: number
  readonly atIsLoading?: boolean
  readonly sessionID?: string
}

export function PromptInputFooter({
  debug,
  verbose,
  exitMessage,
  vimMode,
  mode,
  isLoading,
  isPasting = false,
  isInputWrapped = false,
  config,
  searchState,
  hint,
  commandSuggestions,
  commandSelectedIndex,
  atSuggestions,
  atSelectedIndex,
  atIsLoading,
  sessionID,
}: PromptInputFooterProps) {
  const terminalSize = useContext(TerminalSizeContext)
  const columns = terminalSize?.columns ?? 80
  const isNarrow = useMemo(() => columns < 80, [columns])

  // Determine which overlay is active.
  // We still render the stable left-side box but replace its content — this
  // avoids the one-frame stall caused by full subtree unmount/remount.
  const hasAtSuggestions = atIsLoading || (atSuggestions?.length ?? 0) > 0
  const hasCommandSuggestions = !hasAtSuggestions && (commandSuggestions?.length ?? 0) > 0

  const leftContent = (() => {
    if (searchState?.isSearching) {
      return (
        <HistorySearchInput
          value={searchState.query}
          onChange={searchState.setQuery}
          hasFailedMatch={searchState.hasFailedMatch}
        />
      )
    }

    if (hasAtSuggestions) {
      return (
        <PromptCommandSuggestions
          suggestions={atSuggestions ?? []}
          selectedIndex={atSelectedIndex ?? 0}
          isLoading={atIsLoading}
        />
      )
    }

    if (hasCommandSuggestions) {
      return (
        <PromptCommandSuggestions suggestions={commandSuggestions ?? []} selectedIndex={commandSelectedIndex ?? 0} />
      )
    }

    return (
      <PromptInputFooterLeftSide
        exitMessage={exitMessage}
        vimMode={vimMode}
        mode={mode}
        suppressHint={false}
        isLoading={isLoading}
        isPasting={isPasting}
        config={config}
        hint={hint}
        sessionID={sessionID}
      />
    )
  })()

  return (
    <Box
      flexDirection={isNarrow ? "column" : "row"}
      justifyContent={isNarrow ? "flex-start" : "space-between"}
      paddingX={2}
      gap={isNarrow ? 0 : 1}
    >
      {/* Left slot: stable box — content changes without unmounting the box */}
      <Box flexDirection="column" flexShrink={isNarrow ? 0 : 1} flexGrow={1}>
        {leftContent}
      </Box>

      {/* Right side: toasts / debug */}
      <Box flexShrink={1} gap={1}>
        <Notifications debug={debug} verbose={verbose} isInputWrapped={isInputWrapped} isNarrow={isNarrow} />
      </Box>
    </Box>
  )
}
