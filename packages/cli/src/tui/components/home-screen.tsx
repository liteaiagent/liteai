/**
 * HomeScreen — compact boot-state banner for the LiteAI TUI.
 *
 * Renders a left-aligned context banner (like Gemini CLI / Claude Code) instead of the
 * previous centered Logo + Tip layout. The banner lives inside the ScrollBox scrollable
 * slot and scrolls up naturally when messages arrive — identical to how both reference
 * CLIs handle this in normal-buffer mode.
 *
 * Two visual modes:
 *  - Normal:     logo + version, model, project path, provider/MCP counts, tip
 *  - First-run:  same header but with a bordered "Get Started" box instead of counts,
 *                shown whenever `provider_next.connected.length === 0`
 */

import { Installation } from "@liteai/core/installation/index"
import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useEffect } from "react"
import { useKV } from "../context/kv"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useAppState } from "../state"

export function HomeScreen() {
  const { theme } = useTheme()
  const local = useLocal()
  const kv = useKV()

  // Live-reactive data — re-renders when connections change
  const connectedProviderIds = useAppState((s) => s.provider_next.connected)
  const mcpServers = useAppState((s) => s.mcp)
  const directory = useAppState((s) => s.path.directory || s.path.worktree || process.cwd())

  const hasProviders = connectedProviderIds.length > 0
  const mcpCount = Object.keys(mcpServers).length

  // Resolve human-readable model + provider name
  const { model: modelName, provider: providerName } = local.model.parsed()

  // Mark onboarding complete once the user connects their first provider.
  // The "Get Started" banner visibility is driven purely by `hasProviders` (live),
  // so the KV flag is informational only — useful for future feature gating.
  const isFirstRun = !kv.get("onboarding.completed")
  useEffect(() => {
    if (hasProviders && isFirstRun) {
      kv.set("onboarding.completed", "true")
    }
  }, [hasProviders, isFirstRun, kv])

  return (
    <Box flexDirection="column" paddingTop={1} paddingLeft={2} gap={1}>
      {/* ── Banner: logo + context block ── */}
      <Box flexDirection="row" gap={2} alignItems="flex-start">
        {/* ASCII logo — left column */}
        <LogoMark color={theme.primary as Color} />

        {/* Context block — right column */}
        <Box flexDirection="column">
          <Text color={theme.text as Color} bold>
            LiteAI{" "}
            <Text color={theme.textMuted as Color} bold={false}>
              v{Installation.VERSION}
            </Text>
          </Text>

          {hasProviders ? (
            <>
              <Text color={theme.text as Color}>
                {modelName} <Text color={theme.textMuted as Color}>via {providerName}</Text>
              </Text>
              <Text color={theme.textMuted as Color}>{directory}</Text>
              <Text color={theme.textMuted as Color}>
                {connectedProviderIds.length} provider{connectedProviderIds.length !== 1 ? "s" : ""}
                {mcpCount > 0 && (
                  <>
                    {" · "}
                    {mcpCount} MCP server{mcpCount !== 1 ? "s" : ""}
                  </>
                )}
              </Text>
            </>
          ) : (
            <>
              <Text color={theme.warning as Color}>⚠ No providers connected</Text>
              <Text color={theme.textMuted as Color}>{directory}</Text>
            </>
          )}
        </Box>
      </Box>

      {/* ── First-run "Get Started" box — only when no providers connected ── */}
      {!hasProviders && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.primary as Color}
          paddingX={2}
          paddingY={1}
          marginLeft={2}
        >
          <Text color={theme.text as Color} bold>
            Get Started
          </Text>
          <Box marginTop={1} flexDirection="column" gap={1}>
            <Text color={theme.textMuted as Color}>LiteAI supports 75+ AI providers.</Text>
            <Text color={theme.text as Color}>
              Run{" "}
              <Text color={theme.primary as Color} bold>
                /connect
              </Text>{" "}
              to add your first API key.
            </Text>
            <Text color={theme.text as Color}>
              Or sign in to LiteAI Hub: <Text color={theme.primary as Color}>liteai auth login</Text>
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// LogoMark — compact 5-line monogram mark, no wide ASCII art
// ---------------------------------------------------------------------------

function LogoMark({ color }: { color: Color }) {
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text color={color}> ╱╲ </Text>
      <Text color={color}>╱ ╲</Text>
      <Text color={color}>╲ ╱</Text>
      <Text color={color}> ╲╱ </Text>
    </Box>
  )
}
