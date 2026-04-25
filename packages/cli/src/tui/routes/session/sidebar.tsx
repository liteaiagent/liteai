import type { Color } from "@liteai/ink"
import { Box, ScrollBox, Text } from "@liteai/ink"
import { useMemo } from "react"
import { Divider } from "../../components/design-system/Divider"
import ThemedBox from "../../components/design-system/ThemedBox"
import ThemedText from "../../components/design-system/ThemedText"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"

type Props = {
  sessionID: string
  overlay?: boolean
}

export function Sidebar({ sessionID, overlay }: Props) {
  const sync = useSync()
  const { theme } = useTheme()

  const session = useMemo(() => sync.session.get(sessionID), [sync.session, sessionID])
  const messages = useMemo(() => sync.message[sessionID] ?? [], [sync.message, sessionID])

  const cost = useMemo(() => {
    const total = messages.reduce(
      (sum, x) => sum + (x.role === "assistant" ? ((x as { cost?: number }).cost ?? 0) : 0),
      0,
    )
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  }, [messages])

  if (!session) return null

  return (
    <ThemedBox width={40} height="100%" flexDirection="column" padding={1} position={overlay ? "absolute" : "relative"}>
      <ScrollBox flexGrow={1}>
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <ThemedText bold>{session.title || "New Session"}</ThemedText>
            {session.share?.url && (
              <ThemedText color="textMuted" wrap="truncate-end">
                {session.share.url}
              </ThemedText>
            )}
          </Box>

          <Divider />

          <Box flexDirection="column">
            <Text color={theme.textMuted as Color}>Metadata</Text>
            <Box justifyContent="space-between">
              <Text color={theme.textMuted as Color}>Total Cost</Text>
              <Text color={theme.text as Color}>{cost}</Text>
            </Box>
            <Box justifyContent="space-between">
              <Text color={theme.textMuted as Color}>Messages</Text>
              <Text color={theme.text as Color}>{messages.length}</Text>
            </Box>
          </Box>

          <Divider />

          {/* Additional sidebar sections (MCP, etc.) could be added here */}
          <Box flexDirection="column">
            <Text color={theme.textMuted as Color}>MCP Servers</Text>
            {Object.entries(sync.mcp).map(([name, status]) => (
              <Box key={name} justifyContent="space-between">
                <Text color={theme.textMuted as Color}>{name}</Text>
                <Text color={(status.status === "connected" ? theme.success : theme.error) as Color}>
                  {status.status}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      </ScrollBox>
    </ThemedBox>
  )
}
