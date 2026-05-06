/**
 * ProviderSetupBanner — shown on the home page when no provider is connected.
 *
 * Replaces the prompt input area with a clear call-to-action, guiding the
 * user to connect a provider before they can start chatting. Mirrors the
 * onboarding gate pattern used by Claude Code and Gemini CLI.
 *
 * On Enter → pushes <DialogProvider> which handles the entire auth flow.
 * After successful auth, bootstrap() refreshes provider_next.connected,
 * the gate condition in HomeRoute becomes false, and the normal prompt renders.
 */

import { Box, type Color, Text, useInput } from "@liteai/ink"
import { useDialog } from "../context/dialog"
import { useTheme } from "../context/theme"
import { DialogProvider } from "./dialog-provider"

export function ProviderSetupBanner() {
  const { theme } = useTheme()
  const dialog = useDialog()

  useInput((_input, key) => {
    if (key.return) {
      dialog.push(() => <DialogProvider />)
    }
  })

  return (
    <Box flexDirection="column" alignItems="center" width="100%" maxWidth={80} gap={1}>
      <Text bold color={theme.text as Color}>
        Connect a provider to get started
      </Text>

      <Text color={theme.textMuted as Color}>You can also set API keys via environment variables.</Text>

      <Box marginTop={1}>
        <Text color={theme.primary as Color}>
          Press <Text bold>Enter</Text> to connect a provider
        </Text>
      </Box>
    </Box>
  )
}
