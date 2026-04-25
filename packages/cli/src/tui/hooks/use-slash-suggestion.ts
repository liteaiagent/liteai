import { useMemo } from "react"
import type { InlineGhostText } from "../types/text-input"

/**
 * Hook to compute inline ghost text for slash commands.
 * Checks if the user is typing a known command and returns the remaining suffix.
 */
export function useSlashSuggestion(
  input: string,
  cursorOffset: number,
  knownCommands: string[],
): InlineGhostText | undefined {
  return useMemo(() => {
    // We only suggest if the cursor is at the very end of the input
    if (cursorOffset !== input.length || input.length === 0) {
      return undefined
    }

    // Only suggest when typing a command at the start, or mid-input preceded by space
    const match = input.match(/(?:^|\s)\/([a-zA-Z0-9:\-_]+)$/)
    if (!match || match.index === undefined) {
      return undefined
    }

    const partialCommand = match[1] ?? ""
    if (!partialCommand) {
      return undefined
    }

    // Find the first matching command that starts with what the user typed
    const query = partialCommand.toLowerCase()

    // Sort commands to get deterministic match (e.g., shortest first if multiple prefix match)
    const sortedCommands = [...knownCommands].sort((a, b) => a.localeCompare(b))

    for (const cmdName of sortedCommands) {
      if (cmdName.toLowerCase().startsWith(query)) {
        const suffix = cmdName.slice(partialCommand.length)
        if (suffix) {
          return {
            text: suffix,
            fullCommand: cmdName,
            insertPosition: cursorOffset,
          }
        }
      }
    }

    return undefined
  }, [input, cursorOffset, knownCommands])
}
