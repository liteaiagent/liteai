import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { memo } from "react"
import { useSync } from "../context/sync.tsx"
import { useTheme } from "../context/theme.tsx"

type Props = {
  sessionID: string
}

function StatusLineInner({ sessionID }: Props): React.ReactNode {
  const { theme } = useTheme()
  const sync = useSync()

  const sessionStatus = sync.session.status(sessionID)
  const providerDef = sync.provider_default

  // Dummy data fallback for MVP parity for now
  const model = providerDef?.anthropic || "claude-3-5-sonnet-20241022"
  const cwd = process.cwd()

  const parts = [`Model: ${model}`, `CWD: ${cwd}`, `Status: ${sessionStatus}`]

  return (
    <Box paddingX={1} gap={2} flexDirection="row">
      <Text color={theme.textMuted as Color}>{parts.join(" │ ")}</Text>
    </Box>
  )
}

export const StatusLine = memo(StatusLineInner)
