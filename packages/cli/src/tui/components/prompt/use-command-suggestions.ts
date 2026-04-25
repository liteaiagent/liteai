import type { Command } from "@liteai/sdk"
import { useEffect, useMemo, useState } from "react"
import { useTuiConfig } from "../../context/tui-config"
import {
  findMidInputSlashCommand,
  generateCommandSuggestions,
  hasCommandArgs,
  isCommandInput,
} from "./utils/command-suggestions"
import { getDirectoryCompletions } from "./utils/directory-completion"
import type { SuggestionItem } from "./utils/types"

export function useCommandSuggestions(input: string, cursorOffset: number, commands: Command[]) {
  const config = useTuiConfig()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [directorySuggestions, setDirectorySuggestions] = useState<SuggestionItem[]>([])
  const [_isFetchingDirs, setIsFetchingDirs] = useState(false)

  useEffect(() => {
    let isMounted = true

    if (isCommandInput(input) && cursorOffset > 0) {
      const spaceIndex = input.indexOf(" ")
      if (spaceIndex !== -1) {
        const commandName = input.slice(1, spaceIndex)
        const args = input.slice(spaceIndex + 1)

        if (commandName === "add-dir" && args && !args.match(/\s+$/)) {
          setIsFetchingDirs(true)
          getDirectoryCompletions(args).then((dirs) => {
            if (isMounted) {
              setDirectorySuggestions(dirs)
              setIsFetchingDirs(false)
            }
          })
          return () => {
            isMounted = false
          }
        }
      }
    }

    setDirectorySuggestions([])
    setIsFetchingDirs(false)
    return () => {
      isMounted = false
    }
  }, [input, cursorOffset])

  const midCommandMatch = useMemo(() => findMidInputSlashCommand(input, cursorOffset), [input, cursorOffset])

  const suggestions = useMemo(() => {
    if (directorySuggestions.length > 0) {
      return directorySuggestions
    }

    if (midCommandMatch) {
      return generateCommandSuggestions(midCommandMatch.token, commands, config)
    }

    if (!isCommandInput(input)) return []
    if (hasCommandArgs(input)) return []

    return generateCommandSuggestions(input, commands, config)
  }, [input, commands, directorySuggestions, midCommandMatch, config])

  const active = suggestions.length > 0

  useEffect(() => {
    setSelectedIndex(0)
  }, [suggestions])

  const navigateUp = () => setSelectedIndex((prev) => Math.max(0, prev - 1))
  const navigateDown = () => setSelectedIndex((prev) => Math.min(suggestions.length - 1, prev + 1))

  const getSelected = () => suggestions[selectedIndex]

  return { active, suggestions, selectedIndex, navigateUp, navigateDown, getSelected, midCommandMatch }
}
