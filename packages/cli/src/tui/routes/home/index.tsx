import { Installation } from "@liteai/core/installation/index"
import { Locale } from "@liteai/core/util/locale"
import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useMemo } from "react"
import { Logo } from "../../components/logo"
import { PromptInput } from "../../components/prompt/prompt-input"
import { Tips } from "../../components/tips"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"

export function HomeRoute({ workspaceID }: { workspaceID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const directory = sync.path.directory

  const connectedMcpCount = useMemo(() => {
    return Object.values(sync.mcp).filter((x) => x.status === "connected").length
  }, [sync.mcp])

  const mcpError = useMemo(() => {
    return Object.values(sync.mcp).some((x) => x.status === "failed")
  }, [sync.mcp])

  const hint = useMemo(() => {
    if (connectedMcpCount === 0) return undefined
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={(mcpError ? theme.error : theme.success) as Color}>•</Text>
        <Text color={theme.textMuted as Color}>
          {Locale.pluralize(connectedMcpCount, "{} mcp server", "{} mcp servers")}
        </Text>
      </Box>
    )
  }, [connectedMcpCount, mcpError, theme])

  return (
    <Box flexDirection="column" height="100%" paddingX={2}>
      <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
        <Logo />
        <Box height={1} />
        <Box width="100%" maxWidth={80}>
          <PromptInput workspaceID={workspaceID} hint={hint} debug={false} verbose={false} isLoading={false} />
        </Box>
        <Box height={2} />
        <Tips />
      </Box>

      <Box
        flexDirection="row"
        justifyContent="space-between"
        paddingY={1}
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor={theme.backgroundElement as Color}
      >
        <Box gap={2}>
          <Text color={theme.textMuted as Color}>{directory}</Text>
          {connectedMcpCount > 0 && (
            <Text color={theme.text as Color}>
              <Text color={(mcpError ? theme.error : theme.success) as Color}>⊙ </Text>
              {connectedMcpCount} MCP
            </Text>
          )}
        </Box>
        <Text color={theme.textMuted as Color}>{Installation.VERSION}</Text>
      </Box>
    </Box>
  )
}
