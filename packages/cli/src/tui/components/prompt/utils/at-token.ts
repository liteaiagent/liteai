export type AtToken = {
  token: string // Full token including @ prefix, e.g. "@src/comp" or @"my file"
  searchText: string // Text to search with (@ and quotes stripped), e.g. "src/comp"
  startPos: number // Position of @ in the input string
  endPos: number // Position after last character of the token
  isQuoted: boolean // Whether @"..." syntax is used
}

export type AtApplyResult = {
  newInput: string
  newCursorOffset: number
}

export type AtReference = {
  fullMatch: string // "@src/file.ts" or @"my file.ts"
  path: string // "src/file.ts" or "my file.ts"
  startPos: number
  endPos: number
  isQuoted: boolean
}

/**
 * Extract an @ token starting at or before the cursor offset.
 */
export function extractAtToken(input: string, cursorOffset: number): AtToken | null {
  if (cursorOffset === 0) return null

  // Scan backward to find the nearest '@'
  let atPos = -1
  for (let i = cursorOffset - 1; i >= 0; i--) {
    if (input[i] === "@") {
      // Must be at start of string or preceded by whitespace
      if (i === 0 || /\s/.test(input[i - 1] ?? "")) {
        // Also check if escaped
        if (i > 0 && input[i - 1] === "\\") continue
        atPos = i
        break
      }
    }
  }

  if (atPos === -1) return null

  // We found an unescaped '@' that is at the start of a word.
  // Check if it's quoted: @"
  const isQuoted = input[atPos + 1] === '"'

  let endPos = atPos + 1
  if (isQuoted) {
    endPos++ // skip the quote
    while (endPos < input.length && input[endPos] !== '"' && endPos < cursorOffset) {
      endPos++
    }
    // If we hit the closing quote before the cursor, then the cursor is OUTSIDE the token.
    if (endPos < cursorOffset && input[endPos] === '"') {
      return null
    }
    if (endPos < input.length && input[endPos] === '"') {
      endPos++ // Include closing quote
    } else {
      // Cursor might be inside the quoted string, or we reached the end of the input
      // Set endPos to cursor offset or max available. Let's just use cursorOffset for now
      // as we are "completing" up to the cursor.
      endPos = Math.max(endPos, cursorOffset)
    }
  } else {
    // Unquoted: consume path chars
    // [\p{L}\p{N}\p{M}._\-/\\:]
    const pathCharRegex = /^[\p{L}\p{N}\p{M}._\-/\\:]+$/u
    while (endPos < input.length && endPos < cursorOffset) {
      const ch = input[endPos]
      if (ch !== undefined && pathCharRegex.test(ch)) {
        endPos++
      } else {
        break
      }
    }
    // If the token ends before the cursor, then cursor is not inside the token
    if (endPos < cursorOffset) return null
  }

  const token = input.slice(atPos, endPos)
  let searchText = token.slice(1) // remove @
  if (isQuoted) {
    searchText = searchText.replace(/^"/, "").replace(/"$/, "")
  }

  // If search text is empty and cursor is past @, it's valid to trigger an empty search
  // (e.g. just "@" triggers the top-level directory listing).

  return {
    token,
    searchText,
    startPos: atPos,
    endPos,
    isQuoted,
  }
}

/**
 * Apply a completion replacement for a token.
 */
export function applyAtCompletion(
  input: string,
  _cursorOffset: number, // Required by caller signature — position is derived from token offsets instead
  token: AtToken,
  replacement: string,
  isDirectory: boolean,
): AtApplyResult {
  // If the path contains spaces, we should quote it.
  const needsQuotes = replacement.includes(" ")
  const formattedReplacement = needsQuotes ? `@"${replacement}"` : `@${replacement}`

  const suffix = isDirectory ? "/" : " "

  const before = input.slice(0, token.startPos)
  const after = input.slice(token.endPos)

  // Remove trailing slash from replacement if we are adding one, to avoid //
  let finalReplacement = formattedReplacement
  if (isDirectory && finalReplacement.endsWith("/")) {
    finalReplacement = finalReplacement.slice(0, -1)
  }

  const insertedText = finalReplacement + suffix
  const newInput = before + insertedText + after
  const newCursorOffset = token.startPos + insertedText.length

  return { newInput, newCursorOffset }
}

/**
 * Global parse to extract all @references for submission processing.
 */
export function parseAtReferences(input: string): AtReference[] {
  const references: AtReference[] = []

  // Regex to match unescaped @ followed by either a quoted string or path characters
  // (^|\s)@((?:"[^"]*")|(?:[\p{L}\p{N}\p{M}._\-/\\:]+))
  // We use lookbehind to ensure we don't match escaped \@
  const regex = /(?:^|\s)@((?:"[^"]*")|(?:[\p{L}\p{N}\p{M}._\-/\\:]+))/gu

  for (const match of input.matchAll(regex)) {
    // match[0] might include leading whitespace, so we calculate exact pos based on where @ is.
    const fullMatchWithWhitespace = match[0]
    const atIndex = fullMatchWithWhitespace.indexOf("@")

    // Check if escaped
    if (match.index + atIndex > 0 && input[match.index + atIndex - 1] === "\\") {
      continue
    }

    const startPos = match.index + atIndex
    const rawContent = match[1]
    if (rawContent === undefined) continue
    const fullMatch = `@${rawContent}`
    const endPos = startPos + fullMatch.length

    let path = rawContent
    let isQuoted = false

    if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
      isQuoted = true
      path = path.slice(1, -1)
    }

    references.push({
      fullMatch,
      path,
      startPos,
      endPos,
      isQuoted,
    })
  }

  return references
}
