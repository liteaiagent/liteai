import type { Command } from "@liteai/sdk"
import { useEffect, useMemo, useState } from "react"
import { useSDK } from "../../context/sdk"
import { useTuiConfig } from "../../context/tui-config"
import { useAppState } from "../../state"
import {
  findMidInputSlashCommand,
  generateCommandSuggestions,
  hasCommandArgs,
  isCommandInput,
} from "./utils/command-suggestions"
import { parsePartialPath } from "./utils/directory-completion"
import type { SuggestionItem } from "./utils/types"

export function useCommandSuggestions(input: string, cursorOffset: number, commands: Command[]) {
  const config = useTuiConfig()
  const sdk = useSDK()
  const directory = useAppState((s) => s.path.directory)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [directorySuggestions, setDirectorySuggestions] = useState<SuggestionItem[]>([])
  const [isFetchingDirs, setIsFetchingDirs] = useState(false)

  useEffect(() => {
    let isMounted = true

    if (isCommandInput(input) && cursorOffset > 0) {
      const spaceIndex = input.indexOf(" ")
      if (spaceIndex !== -1) {
        const commandName = input.slice(1, spaceIndex)
        const args = input.slice(spaceIndex + 1)

        if (commandName === "add-dir" && args !== undefined && !args.match(/\s+$/)) {
          setIsFetchingDirs(true)

          const fetchDirs = async () => {
            try {
              const { directory: dirPath, prefix } = parsePartialPath(args, directory)
              const response = await sdk.client.project.file.list({
                projectID: sdk.projectID,
                path: dirPath,
              })

              if (!isMounted) return

              if (response.error) {
                console.warn("[directory-completion] SDK file.list returned error:", response.error)
                setDirectorySuggestions([])
                return
              }

              const entries = (response.data ?? [])
                .filter((node) => node.type === "directory")
                .filter((node) => node.name.toLowerCase().startsWith(prefix.toLowerCase()))
                .slice(0, 10)
                .map((node) => ({
                  id: node.path ?? `${dirPath}/${node.name}`,
                  displayText: `${node.name}/`,
                  description: "directory",
                  metadata: { type: "directory" as const },
                }))

              setDirectorySuggestions(entries)
            } catch (error) {
              // Tab-completion degrades gracefully: show empty suggestions on API failure.
              // Logged for observability so network issues are detectable during UAT.
              console.warn("[directory-completion] SDK file.list failed:", error)
              if (isMounted) setDirectorySuggestions([])
            } finally {
              if (isMounted) setIsFetchingDirs(false)
            }
          }

          void fetchDirs()

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
  }, [input, cursorOffset, sdk, directory])

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

  return { active, suggestions, selectedIndex, navigateUp, navigateDown, getSelected, midCommandMatch, isFetchingDirs }
}
