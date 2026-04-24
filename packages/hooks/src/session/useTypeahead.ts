import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounceCallback } from 'usehooks-ts'
import type { InlineGhostText, NotificationPort, SuggestionItem, SuggestionType, TypeaheadPorts } from '../types.js'
import { type Command, findMidInputSlashCommand, getBestCommandMatch } from '../utils/commandSuggestions.js'
import {
  extractCompletionToken,
  extractSearchToken,
  getPreservedSelection,
  HAS_AT_SYMBOL_RE,
  HASH_CHANNEL_RE,
} from '../utils/suggestionUtils.js'

export interface TypeaheadState {
  suggestions: SuggestionItem[]
  selectedSuggestion: number
  commandArgumentHint?: string
}

export interface TypeaheadProps {
  input: string
  cursorOffset: number
  mode: string
  ports: TypeaheadPorts
  notificationPort: NotificationPort
  onInputChange: (value: string) => void
  onSubmit: (value: string, isSubmittingSlashCommand?: boolean) => void
  setCursorOffset: (offset: number) => void
  options?: {
    suppressSuggestions?: boolean
    mcpResources?: unknown
    agents?: unknown
    clients?: unknown
    commands?: Command[]
  }
}

export interface TypeaheadResult {
  suggestions: SuggestionItem[]
  selectedSuggestion: number
  suggestionType: SuggestionType
  commandArgumentHint?: string
  inlineGhostText?: InlineGhostText
  handleKeyDown: (e: KeyboardEvent<unknown>) => boolean // returns true if handled
}

const DEFAULT_COMMANDS: Command[] = []
const DEFAULT_OPTIONS = {}

export function useTypeahead({
  input,
  cursorOffset,
  mode,
  ports,
  notificationPort: _notificationPort, // Genuinely unused in current implementation but kept for interface compliance
  onInputChange,
  onSubmit: _onSubmit, // Genuinely unused in current implementation but kept for interface compliance
  setCursorOffset,
  options = DEFAULT_OPTIONS,
}: TypeaheadProps): TypeaheadResult {
  const { suppressSuggestions = false, mcpResources, agents, clients, commands = DEFAULT_COMMANDS } = options

  const [state, setState] = useState<TypeaheadState>({
    suggestions: [],
    selectedSuggestion: -1,
  })
  const [suggestionType, setSuggestionType] = useState<SuggestionType>('none')
  const [inlineGhostText, setInlineGhostText] = useState<InlineGhostText | undefined>(undefined)

  const syncPromptGhostText = useMemo((): InlineGhostText | undefined => {
    if (mode !== 'prompt' || suppressSuggestions) return undefined
    const midInputCommand = findMidInputSlashCommand(input, cursorOffset)
    if (!midInputCommand) return undefined
    const match = getBestCommandMatch(midInputCommand.partialCommand, commands)
    if (!match) return undefined
    return {
      text: match.suffix,
      fullCommand: match.fullCommand,
      insertPosition: midInputCommand.startPos + 1 + midInputCommand.partialCommand.length,
    }
  }, [input, cursorOffset, mode, commands, suppressSuggestions])

  const effectiveGhostText = suppressSuggestions ? undefined : mode === 'prompt' ? syncPromptGhostText : inlineGhostText

  const latestSearchTokenRef = useRef<string | null>(null)
  const prevInputRef = useRef('')
  const latestBashInputRef = useRef('')
  const latestSlackTokenRef = useRef('')
  const dismissedForInputRef = useRef<string | null>(null)

  const clearSuggestions = useCallback(() => {
    setState({
      commandArgumentHint: undefined,
      suggestions: [],
      selectedSuggestion: -1,
    })
    setSuggestionType('none')
    setInlineGhostText(undefined)
  }, [])

  const fetchFileSuggestions = useCallback(
    async (searchToken: string, isAtSymbol = false): Promise<void> => {
      latestSearchTokenRef.current = searchToken
      const combinedItems = await ports.generateUnifiedSuggestions(searchToken, mcpResources, agents, isAtSymbol)
      if (latestSearchTokenRef.current !== searchToken) return

      if (combinedItems.length === 0) {
        clearSuggestions()
        return
      }

      setState((prev) => ({
        commandArgumentHint: undefined,
        suggestions: combinedItems,
        selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, combinedItems),
      }))
      setSuggestionType('file')
    },
    [ports, mcpResources, agents, clearSuggestions],
  )

  const debouncedFetchFileSuggestions = useDebounceCallback(fetchFileSuggestions, 50)

  const fetchSlackChannels = useCallback(
    async (partial: string): Promise<void> => {
      latestSlackTokenRef.current = partial
      const channels = await ports.getSlackChannelSuggestions(clients, partial)
      if (latestSlackTokenRef.current !== partial) return

      setState((prev) => ({
        commandArgumentHint: undefined,
        suggestions: channels,
        selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, channels),
      }))
      setSuggestionType(channels.length > 0 ? 'slack-channel' : 'none')
    },
    [ports, clients],
  )

  const debouncedFetchSlackChannels = useDebounceCallback(fetchSlackChannels, 150)

  const updateSuggestions = useCallback(
    async (value: string, inputCursorOffset?: number): Promise<void> => {
      const effectiveCursorOffset = inputCursorOffset ?? cursorOffset

      if (suppressSuggestions) {
        debouncedFetchFileSuggestions.cancel()
        clearSuggestions()
        return
      }

      // Prompt mode: ghost text logic
      if (mode === 'prompt') {
        const midInputCommand = findMidInputSlashCommand(value, effectiveCursorOffset)
        if (midInputCommand) {
          const match = getBestCommandMatch(midInputCommand.partialCommand, commands)
          if (match) {
            setState({
              commandArgumentHint: undefined,
              suggestions: [],
              selectedSuggestion: -1,
            })
            setSuggestionType('none')
            return
          }
        }
      }

      // Bash mode: history ghost text
      if (mode === 'bash' && value.trim()) {
        latestBashInputRef.current = value
        const historyMatch = await ports.getShellHistoryCompletion(value)
        if (latestBashInputRef.current !== value) return

        if (historyMatch) {
          setInlineGhostText({
            text: historyMatch.suffix,
            fullCommand: historyMatch.fullCommand,
            insertPosition: value.length,
          })
          setState({
            commandArgumentHint: undefined,
            suggestions: [],
            selectedSuggestion: -1,
          })
          setSuggestionType('none')
          return
        } else {
          setInlineGhostText(undefined)
        }
      }

      // Command suggestions
      if (mode === 'prompt' && value.startsWith('/') && effectiveCursorOffset > 0) {
        // Simple logic for command suggestions (placeholder for now)
        const commandItems = ports.generateCommandSuggestions(value, commands)
        if (commandItems.length > 0) {
          setState({
            commandArgumentHint: undefined,
            suggestions: commandItems,
            selectedSuggestion: 0,
          })
          setSuggestionType('command')
          return
        }
      }

      // @ mentions
      const atMatch = mode !== 'bash' ? value.substring(0, effectiveCursorOffset).match(HAS_AT_SYMBOL_RE) : null
      if (atMatch) {
        const completionToken = extractCompletionToken(value, effectiveCursorOffset, true)
        if (completionToken?.token.startsWith('@')) {
          const searchToken = extractSearchToken(completionToken)
          if (latestSearchTokenRef.current === searchToken) return
          void debouncedFetchFileSuggestions(searchToken, true)
          return
        }
      }

      // # slack channels
      if (mode === 'prompt') {
        const hashMatch = value.substring(0, effectiveCursorOffset).match(HASH_CHANNEL_RE)
        if (hashMatch?.[2]) {
          debouncedFetchSlackChannels(hashMatch[2])
          return
        }
      }

      clearSuggestions()
    },
    [
      cursorOffset,
      suppressSuggestions,
      mode,
      commands,
      ports,
      debouncedFetchFileSuggestions,
      clearSuggestions,
      debouncedFetchSlackChannels,
    ],
  )

  const updateSuggestionsRef = useRef<typeof updateSuggestions>(updateSuggestions)
  updateSuggestionsRef.current = updateSuggestions

  useEffect(() => {
    if (dismissedForInputRef.current === input) return
    if (prevInputRef.current !== input) {
      prevInputRef.current = input
      latestSearchTokenRef.current = null
    }
    dismissedForInputRef.current = null
    void updateSuggestionsRef.current(input)
  }, [input]) // Only depend on input

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<unknown>): boolean => {
      const { key } = e

      if (key === 'ArrowUp' && state.suggestions.length > 0) {
        setState((prev) => ({
          ...prev,
          selectedSuggestion: prev.selectedSuggestion <= 0 ? prev.suggestions.length - 1 : prev.selectedSuggestion - 1,
        }))
        e.preventDefault?.()
        return true
      }

      if (key === 'ArrowDown' && state.suggestions.length > 0) {
        setState((prev) => ({
          ...prev,
          selectedSuggestion: prev.selectedSuggestion >= prev.suggestions.length - 1 ? 0 : prev.selectedSuggestion + 1,
        }))
        e.preventDefault?.()
        return true
      }

      if (key === 'Escape' && state.suggestions.length > 0) {
        dismissedForInputRef.current = input
        clearSuggestions()
        e.preventDefault?.()
        return true
      }

      if (key === 'Tab') {
        // Tab logic (simplified)
        if (effectiveGhostText) {
          onInputChange(effectiveGhostText.fullCommand)
          setCursorOffset(effectiveGhostText.fullCommand.length)
          e.preventDefault?.()
          return true
        }
        if (state.suggestions.length > 0) {
          const index = state.selectedSuggestion === -1 ? 0 : state.selectedSuggestion
          const suggestion = state.suggestions[index]
          if (suggestion) {
            // Apply suggestion (simplified)
            onInputChange(suggestion.displayText)
            setCursorOffset(suggestion.displayText.length)
            clearSuggestions()
            e.preventDefault?.()
            return true
          }
        }
      }

      return false
    },
    [state, input, clearSuggestions, effectiveGhostText, onInputChange, setCursorOffset],
  )

  return {
    suggestions: state.suggestions,
    selectedSuggestion: state.selectedSuggestion,
    suggestionType,
    commandArgumentHint: state.commandArgumentHint,
    inlineGhostText: effectiveGhostText,
    handleKeyDown,
  }
}
