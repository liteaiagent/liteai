import { Box, type Color, Text } from "@liteai/ink"
import { useSyncExternalStore } from "react"
import { useTheme } from "../../context/theme"
import { getSnapshot, subscribe } from "../../stores/message-queue-store"

const MAX_VISIBLE = 3
const MAX_PREVIEW_LENGTH = 80

export function QueuedMessageDisplay(): React.ReactNode {
  const queue = useSyncExternalStore(subscribe, getSnapshot)
  const { theme } = useTheme()

  if (queue.length === 0) return null

  const visible = queue.slice(0, MAX_VISIBLE)
  const overflow = queue.length - MAX_VISIBLE

  return (
    <Box flexDirection="column" paddingX={2} marginBottom={1}>
      <Text color={theme.text as Color} dim>
        Queued ({queue.length}) — Ctrl+C to clear:
      </Text>
      {visible.map((msg) => {
        const preview = msg.text.replace(/\s+/g, " ").slice(0, MAX_PREVIEW_LENGTH)
        const truncated = msg.text.length > MAX_PREVIEW_LENGTH ? "..." : ""
        return (
          <Box key={msg.id} paddingLeft={2}>
            <Text dim wrap="truncate">
              › {preview}
              {truncated}
            </Text>
          </Box>
        )
      })}
      {overflow > 0 && (
        <Box paddingLeft={2}>
          <Text dim>(+{overflow} more)</Text>
        </Box>
      )}
    </Box>
  )
}
