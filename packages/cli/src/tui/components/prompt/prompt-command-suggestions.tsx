import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useTheme } from "../../context/theme"
import type { SuggestionItem } from "./utils/types"

type PromptCommandSuggestionsProps = {
  suggestions: SuggestionItem[]
  selectedIndex: number
  isLoading?: boolean
  maxVisible?: number
}

export function PromptCommandSuggestions({
  suggestions,
  selectedIndex,
  isLoading,
  maxVisible = 8,
}: PromptCommandSuggestionsProps) {
  const { theme } = useTheme()

  if (isLoading) {
    return (
      <Box flexDirection="column" width="100%" paddingX={2}>
        <Text dim>Searching...</Text>
      </Box>
    )
  }

  if (suggestions.length === 0) return null

  // Calculate scrolling window
  let startIdx = 0
  let endIdx = suggestions.length

  if (suggestions.length > maxVisible) {
    // Keep selectedIndex in the middle of the window if possible
    startIdx = Math.max(0, selectedIndex - Math.floor(maxVisible / 2))
    endIdx = Math.min(suggestions.length, startIdx + maxVisible)

    // Adjust window if we hit the end
    if (endIdx === suggestions.length) {
      startIdx = Math.max(0, endIdx - maxVisible)
    }
  }

  const visibleSuggestions = suggestions.slice(startIdx, endIdx)
  const hasMoreTop = startIdx > 0
  const hasMoreBottom = endIdx < suggestions.length

  let lastTag: string | undefined

  return (
    <Box flexDirection="column" width="100%" paddingX={2}>
      {hasMoreTop && (
        <Box width="100%" justifyContent="center">
          <Text dim>▲</Text>
        </Box>
      )}

      {visibleSuggestions.map((item, i) => {
        const actualIndex = startIdx + i
        const isSelected = actualIndex === selectedIndex

        const showHeader = item.tag && item.tag !== lastTag
        lastTag = item.tag

        return (
          <Box key={item.id} width="100%" flexDirection="column">
            {showHeader && (
              <Box marginY={0}>
                <Text dim>-- {item.tag?.replace(/[[\]]/g, "")} --</Text>
              </Box>
            )}
            <Box width="100%">
              <Text color={(isSelected ? theme.accent : theme.text) as Color} dim={!isSelected} wrap="truncate">
                {item.displayText}
                {item.tag ? ` ${item.tag}` : ""}
                {item.description ? ` — ${item.description}` : ""}
              </Text>
            </Box>
          </Box>
        )
      })}

      {hasMoreBottom && (
        <Box width="100%" justifyContent="center">
          <Text dim>▼</Text>
        </Box>
      )}
    </Box>
  )
}
