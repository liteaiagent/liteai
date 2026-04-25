import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useKV } from "../../context/kv"
import { useTheme } from "../../context/theme"
import { useSessionContext } from "./ctx"

export function SessionHeader() {
  const kv = useKV()
  const { theme } = useTheme()
  const ctx = useSessionContext()

  const visible = kv.get("header_visible", true)
  if (!visible) return null

  const session = ctx.sync.session.get(ctx.sessionID)
  if (!session) return null

  const messages = ctx.sync.message[ctx.sessionID] ?? []
  const lastUser = messages.findLast((m) => m.role === "user")
  const agentId = lastUser?.role === "user" ? lastUser.agent : "liteai"
  const modelId = lastUser?.role === "user" ? lastUser.model.modelID : "default-model"

  const agent = ctx.sync.agent.find((a) => a.name === agentId)
  const agentName = agent?.name ?? "Agent"

  return (
    <Box flexShrink={0} width="100%" height={1} justifyContent="space-between">
      <Box flexShrink={1} flexGrow={0} overflow="hidden">
        <Text color={theme.text as Color} wrap="truncate-end">
          {session.title || "New Session"}
        </Text>
      </Box>
      <Box flexShrink={0} paddingLeft={2}>
        <Text color={theme.textMuted as Color}>
          {agentName} • {modelId}
        </Text>
      </Box>
    </Box>
  )
}
