import { Installation } from "@liteai/core/installation/index"
import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { Locale } from "@liteai/util/locale"
import { useMemo } from "react"
import { useExitState } from "../../components/global-exit-handler"
import { Logo } from "../../components/logo"
import { PromptInput } from "../../components/prompt/prompt-input"
import { ProviderSetupBanner } from "../../components/provider-setup-banner"
import { Tips } from "../../components/tips"
import { useTheme } from "../../context/theme"
import { useIdleWindowTitle } from "../../hooks/use-window-title"
import { useAppState } from "../../state"

function getFolderName(dir: string): string {
  const parts = dir.replace(/\\/g, "/").split("/")
  return parts[parts.length - 1] || dir
}

export function HomeRoute({ workspaceID }: { workspaceID: string }) {
  const directory = useAppState((s) => s.path.directory)
  const mcp = useAppState((s) => s.mcp)
  const connectedProviders = useAppState((s) => s.provider_next.connected)
  const hasConnectedProvider = connectedProviders.length > 0
  const { theme } = useTheme()
  const exitState = useExitState()

  // Terminal title bar: "LiteAI (folder)"
  const folderName = useMemo(() => getFolderName(directory || process.cwd()), [directory])
  useIdleWindowTitle(folderName)

  const connectedMcpCount = useMemo(() => {
    return Object.values(mcp).filter((x) => x.status === "connected").length
  }, [mcp])

  const mcpError = useMemo(() => {
    return Object.values(mcp).some((x) => x.status === "failed")
  }, [mcp])

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
        {hasConnectedProvider ? (
          <>
            <Box width="100%" maxWidth={80}>
              <PromptInput workspaceID={workspaceID} hint={hint} debug={false} verbose={false} isLoading={false} />
            </Box>
            <Box height={2} />
            <Tips />
          </>
        ) : (
          <ProviderSetupBanner />
        )}
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
        {exitState.pending ? (
          <Text dim italic>
            Press {exitState.keyName} again to exit
          </Text>
        ) : (
          <Box gap={2}>
            <Text color={theme.textMuted as Color}>{directory}</Text>
            {connectedMcpCount > 0 && (
              <Text color={theme.text as Color}>
                <Text color={(mcpError ? theme.error : theme.success) as Color}>⊙ </Text>
                {connectedMcpCount} MCP
              </Text>
            )}
          </Box>
        )}
        <Text color={theme.textMuted as Color}>{Installation.VERSION}</Text>
      </Box>
    </Box>
  )
}
