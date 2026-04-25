import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useTheme } from "../../context/theme"
import type { SuggestionItem } from "./utils/types"

type PromptCommandSuggestionsProps = {
  suggestions: SuggestionItem[]
  selectedIndex: number
}

export function PromptCommandSuggestions({ suggestions, selectedIndex }: PromptCommandSuggestionsProps) {
  const { theme } = useTheme()

  if (suggestions.length === 0) return null

  return (
    <Box flexDirection="column" width="100%" paddingX={2}>
      {suggestions.map((item, i) => {
        const isSelected = i === selectedIndex
        return (
          <Box key={item.id} width="100%">
            <Text color={(isSelected ? theme.accent : theme.text) as Color} dim={!isSelected} wrap="truncate">
              {item.displayText}
              {item.description ? ` — ${item.description}` : ""}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
