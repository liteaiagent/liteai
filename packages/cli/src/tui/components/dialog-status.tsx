import { Box, type Color, Text } from "@liteai/ink"
import { useMemo } from "react"
import { useTheme } from "../context/theme"
import { useDialogLifecycle } from "../primitives/use-dialog-lifecycle"
import { useAppState } from "../state"

export function DialogStatus({ onClose }: { onClose: () => void }) {
  useDialogLifecycle({
    contextName: "Select",
    onClose,
    isActive: true,
  })

  const mcp = useAppState((s) => s.mcp)
  const lsp = useAppState((s) => s.lsp)
  const formatter = useAppState((s) => s.formatter)
  const { theme } = useTheme()

  const enabledFormatters = useMemo(() => formatter.filter((f) => f.enabled), [formatter])

  return (
    <Box paddingLeft={2} paddingRight={2} flexDirection="column" gap={1} paddingBottom={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={theme.text as Color} bold>
          Status
        </Text>
        <Text color={theme.textMuted as Color}>esc</Text>
      </Box>

      {Object.keys(mcp).length > 0 ? (
        <Box flexDirection="column">
          <Text color={theme.text as Color}>{Object.keys(mcp).length} MCP Servers</Text>
          {Object.entries(mcp).map(([key, item]) => {
            const statusColor =
              (
                {
                  connected: theme.success,
                  failed: theme.error,
                  disabled: theme.textMuted,
                  needs_auth: theme.warning,
                  needs_client_registration: theme.error,
                } as Record<string, string>
              )[item.status] || theme.success

            let statusText: string = item.status
            if (item.status === "connected") statusText = "Connected"
            else if (item.status === "failed") statusText = (item as { error?: string }).error || "Failed"
            else if (item.status === "disabled") statusText = "Disabled in configuration"
            else if (item.status === "needs_auth") statusText = `Needs authentication (run: liteai mcp auth ${key})`
            else if (item.status === "needs_client_registration")
              statusText = (item as { error?: string }).error || "Needs client registration"

            return (
              <Box flexDirection="row" gap={1} key={key}>
                <Text color={statusColor as Color}>•</Text>
                <Text color={theme.text as Color} wrap="wrap">
                  <Text bold>{key}</Text> <Text color={theme.textMuted as Color}>{statusText}</Text>
                </Text>
              </Box>
            )
          })}
        </Box>
      ) : (
        <Text color={theme.text as Color}>No MCP Servers</Text>
      )}

      {lsp.length > 0 && (
        <Box flexDirection="column">
          <Text color={theme.text as Color}>{lsp.length} LSP Servers</Text>
          {lsp.map((item) => (
            <Box flexDirection="row" gap={1} key={item.id}>
              <Text color={(item.status === "connected" ? theme.success : theme.error) as Color}>•</Text>
              <Text color={theme.text as Color} wrap="wrap">
                <Text bold>{item.id}</Text> <Text color={theme.textMuted as Color}>{item.root}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {enabledFormatters.length > 0 ? (
        <Box flexDirection="column">
          <Text color={theme.text as Color}>{enabledFormatters.length} Formatters</Text>
          {enabledFormatters.map((item) => (
            <Box flexDirection="row" gap={1} key={item.name}>
              <Text color={theme.success as Color}>•</Text>
              <Text wrap="wrap" color={theme.text as Color}>
                <Text bold>{item.name}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Text color={theme.text as Color}>No Formatters</Text>
      )}
    </Box>
  )
}
