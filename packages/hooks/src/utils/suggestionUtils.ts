import type { SuggestionItem } from '../types.js'

// Unicode-aware character class for file path tokens:
export const AT_TOKEN_HEAD_RE = /^@[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*/u
export const PATH_CHAR_HEAD_RE = /^[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+/u
export const TOKEN_WITH_AT_RE = /(@[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*|[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+)$/u
export const TOKEN_WITHOUT_AT_RE = /[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+$/u
export const HAS_AT_SYMBOL_RE = /(^|\s)@([\p{L}\p{N}\p{M}_\-./\\()[\]~:]*|"[^"]*"?)$/u
export const HASH_CHANNEL_RE = /(^|\s)#([a-z0-9][a-z0-9_-]*)$/

/**
 * Extract search token from a completion token by removing @ prefix and quotes
 */
export function extractSearchToken(completionToken: { token: string; isQuoted?: boolean }): string {
  if (completionToken.isQuoted) {
    // Remove @" prefix and optional closing "
    return completionToken.token.slice(2).replace(/"$/, '')
  } else if (completionToken.token.startsWith('@')) {
    return completionToken.token.substring(1)
  } else {
    return completionToken.token
  }
}

/**
 * Extract a completable token at the cursor position
 */
export function extractCompletionToken(
  text: string,
  cursorPos: number,
  includeAtSymbol = false,
): {
  token: string
  startPos: number
  isQuoted?: boolean
} | null {
  if (!text) return null
  const textBeforeCursor = text.substring(0, cursorPos)

  // Check for quoted @ mention first (e.g., @"my file with spaces")
  if (includeAtSymbol) {
    const quotedAtRegex = /@"([^"]*)"?$/
    const quotedMatch = textBeforeCursor.match(quotedAtRegex)
    if (quotedMatch && quotedMatch.index !== undefined) {
      const textAfterCursor = text.substring(cursorPos)
      const afterQuotedMatch = textAfterCursor.match(/^[^"]*"?/)
      const quotedSuffix = afterQuotedMatch ? afterQuotedMatch[0] : ''
      return {
        token: quotedMatch[0] + quotedSuffix,
        startPos: quotedMatch.index,
        isQuoted: true,
      }
    }
  }

  // Fast path for @ tokens
  if (includeAtSymbol) {
    const atIdx = textBeforeCursor.lastIndexOf('@')
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1] ?? ''))) {
      const fromAt = textBeforeCursor.substring(atIdx)
      const atHeadMatch = fromAt.match(AT_TOKEN_HEAD_RE)
      if (atHeadMatch && atHeadMatch[0].length === fromAt.length) {
        const textAfterCursor = text.substring(cursorPos)
        const afterMatch = textAfterCursor.match(PATH_CHAR_HEAD_RE)
        const tokenSuffix = afterMatch ? afterMatch[0] : ''
        return {
          token: atHeadMatch[0] + tokenSuffix,
          startPos: atIdx,
          isQuoted: false,
        }
      }
    }
  }

  const tokenRegex = includeAtSymbol ? TOKEN_WITH_AT_RE : TOKEN_WITHOUT_AT_RE
  const match = textBeforeCursor.match(tokenRegex)
  if (!match || match.index === undefined) {
    return null
  }

  const textAfterCursor = text.substring(cursorPos)
  const afterMatch = textAfterCursor.match(PATH_CHAR_HEAD_RE)
  const tokenSuffix = afterMatch ? afterMatch[0] : ''
  return {
    token: match[0] + tokenSuffix,
    startPos: match.index,
    isQuoted: false,
  }
}

/**
 * Format a replacement value with proper @ prefix and quotes based on context
 */
export function formatReplacementValue(options: {
  displayText: string
  mode: string
  hasAtPrefix: boolean
  needsQuotes: boolean
  isQuoted?: boolean
  isComplete: boolean
}): string {
  const { displayText, mode, hasAtPrefix, needsQuotes, isQuoted, isComplete } = options
  const space = isComplete ? ' ' : ''
  if (isQuoted || needsQuotes) {
    return mode === 'bash' ? `"${displayText}"${space}` : `@"${displayText}"${space}`
  } else if (hasAtPrefix) {
    return mode === 'bash' ? `${displayText}${space}` : `@${displayText}${space}`
  } else {
    return displayText
  }
}

export function getPreservedSelection(
  prevSuggestions: SuggestionItem[],
  prevSelection: number,
  newSuggestions: SuggestionItem[],
): number {
  if (newSuggestions.length === 0) return -1
  if (prevSelection < 0) return 0
  const prevSelectedItem = prevSuggestions[prevSelection]
  if (!prevSelectedItem) return 0
  const newIndex = newSuggestions.findIndex((item) => item.id === prevSelectedItem.id)
  return newIndex >= 0 ? newIndex : 0
}

export function findLongestCommonPrefix(suggestions: SuggestionItem[]): string {
  if (suggestions.length === 0) return ''
  let prefix = suggestions[0]?.displayText ?? ''
  for (let i = 1; i < suggestions.length; i++) {
    const s = suggestions[i]?.displayText ?? ''
    let j = 0
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) {
      j++
    }
    prefix = prefix.slice(0, j)
    if (prefix === '') break
  }
  return prefix
}
