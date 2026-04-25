import { Box, type Color, stringWidth, Text } from "@liteai/ink"
import { useTheme } from "../../context/theme"
import { TextInput } from "../text-input"

type Props = {
  value: string
  onChange: (value: string) => void
  hasFailedMatch: boolean
}

export function HistorySearchInput({ value, onChange, hasFailedMatch }: Props) {
  const { theme } = useTheme()
  const prefix = hasFailedMatch ? "no matching prompt:" : "search prompts:"

  // Use stringWidth to precisely constrain the input width
  const columns = stringWidth(value) + 1

  return (
    <Box gap={1}>
      <Text color={theme.textMuted as Color}>{prefix}</Text>
      <TextInput
        value={value}
        onChange={onChange}
        cursorOffset={value.length}
        onChangeCursorOffset={() => {}} // Read-only cursor offset at end
        columns={columns}
        focus={true}
        showCursor={true}
        multiline={false}
        dimColor={true}
      />
    </Box>
  )
}
