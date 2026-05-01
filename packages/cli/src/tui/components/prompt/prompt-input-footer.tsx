/**
 * Prompt input footer — the row below the text input.
 * Adapted port from MVP `PromptInput/PromptInputFooter.tsx`.
 *
 * Layout (horizontal):
 * ┌──────────────────────────────────────────────────────────┐
 * │ [FooterLeftSide]                         [Notifications] │
 * └──────────────────────────────────────────────────────────┘
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
}: PromptInputFooterProps) {
  const terminalSize = useContext(TerminalSizeContext)
  const columns = terminalSize?.columns ?? 80
  const isNarrow = useMemo(() => columns < 80, [columns])

  if (atIsLoading || (atSuggestions && atSuggestions.length > 0)) {
    return (
      <PromptCommandSuggestions
        suggestions={atSuggestions ?? []}
        selectedIndex={atSelectedIndex ?? 0}
        isLoading={atIsLoading}
      />
    )
  }

  if (commandSuggestions && commandSuggestions.length > 0) {
    return <PromptCommandSuggestions suggestions={commandSuggestions} selectedIndex={commandSelectedIndex ?? 0} />
  }

  return (
    <Box
      flexDirection={isNarrow ? "column" : "row"}
      justifyContent={isNarrow ? "flex-start" : "space-between"}
      paddingX={2}
      gap={isNarrow ? 0 : 1}
    >
      {/* Left side: exit message / vim mode / hints / history search */}
      <Box flexDirection="column" flexShrink={isNarrow ? 0 : 1}>
        {searchState?.isSearching ? (
          <HistorySearchInput
            value={searchState.query}
            onChange={searchState.setQuery}
            hasFailedMatch={searchState.hasFailedMatch}
          />
        ) : (
          <PromptInputFooterLeftSide
            exitMessage={exitMessage}
            vimMode={vimMode}
            mode={mode}
            suppressHint={false}
            isLoading={isLoading}
            isPasting={isPasting}
            config={config}
            hint={hint}
          />
        )}
      </Box>

      {/* Right side: model name / debug / toast */}
      <Box flexShrink={1} gap={1}>
        <Notifications debug={debug} verbose={verbose} isInputWrapped={isInputWrapped} isNarrow={isNarrow} />
      </Box>
    </Box>
  )
}
