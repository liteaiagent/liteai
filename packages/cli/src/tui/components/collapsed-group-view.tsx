import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type { AssistantMessage } from "@liteai/sdk"
import { useMemo } from "react"
import { ToolDisplayStatus } from "../constants/tool-status"
import { useMessageCursorContext } from "../context/message-cursor"
import { useTheme } from "../context/theme"
import { PART_MAPPING } from "../routes/session/parts"
import { selectPermissions, useAppState } from "../state"
import type { ToolGroupPart } from "../utils/collapse-tool-groups"
import { mapToolPartToDisplayStatus } from "../utils/tool-display-status"

/** Status indicator character per display status — inline version for collapsed groups */
const STATUS_CHARS: Record<ToolDisplayStatus, string> = {
  [ToolDisplayStatus.Pending]: "○",
  [ToolDisplayStatus.Executing]: "·",
  [ToolDisplayStatus.Success]: "✓",
  [ToolDisplayStatus.Confirming]: "?",
  [ToolDisplayStatus.Cancelled]: "–",
  [ToolDisplayStatus.Error]: "✗",
}

export function CollapsedGroupView({
  part,
  message,
  last,
}: {
  part: ToolGroupPart
  message: AssistantMessage
  last: boolean
}) {
  const { theme } = useTheme()
  const cursorCtx = useMessageCursorContext()
  const isExpanded = cursorCtx.isExpanded(message.id)
  const permissions = useAppState(selectPermissions(message.sessionID))

  const summary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tool of part.tools) {
      counts.set(tool.tool, (counts.get(tool.tool) ?? 0) + 1)
    }
    const parts = Array.from(counts.entries()).map(([name, count]) => `${count} ${name}`)
    return `Ran ${parts.join(", ")}`
  }, [part.tools])

  const statusIndicators = useMemo(() => {
    return part.tools
      .map((tool) => {
        const status = mapToolPartToDisplayStatus(tool, permissions)
        return STATUS_CHARS[status]
      })
      .join("")
  }, [part.tools, permissions])

  if (isExpanded) {
    const ToolView = PART_MAPPING.tool
    return (
      <Box flexDirection="column">
        {part.tools.map((t, idx) => {
          if (!ToolView) return null
          return <ToolView key={t.id} part={t} message={message} last={last && idx === part.tools.length - 1} />
        })}
      </Box>
    )
  }

  return (
    <Box paddingLeft={3} marginTop={1} gap={1}>
      <Text color={theme.textMuted as Color} italic>
        ▶ {statusIndicators} {summary}
      </Text>
    </Box>
  )
}
