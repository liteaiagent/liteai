import type { Color } from "@liteai/ink"
import { Box, Text, useInput } from "@liteai/ink"
import type { PermissionRequest } from "@liteai/sdk"
import React, { useMemo, useState } from "react"
import ThemedBox from "../../components/design-system/ThemedBox"
import ThemedText from "../../components/design-system/ThemedText"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useSessionContext } from "./ctx"
import { normalizePath } from "./utils"

export function PermissionPrompt({ request }: { request: PermissionRequest }) {
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()
  const [selected, setSelected] = useState<"once" | "always" | "reject">("once")

  const options = ["once", "always", "reject"] as const

  useInput((input, key) => {
    if (key.leftArrow || input === "h") {
      const idx = options.indexOf(selected)
      setSelected(options[(idx - 1 + options.length) % options.length])
    }
    if (key.rightArrow || input === "l") {
      const idx = options.indexOf(selected)
      setSelected(options[(idx + 1) % options.length])
    }
    if (key.return) {
      sdk.client.project.permission.reply({
        projectID: sdk.projectID,
        reply: selected,
        requestID: request.id,
      })
    }
    if (key.escape) {
      sdk.client.project.permission.reply({
        projectID: sdk.projectID,
        reply: "reject",
        requestID: request.id,
      })
    }
  })

  return (
    <ThemedBox borderStyle="single" borderColor={theme.warning as Color} padding={1} flexDirection="column" gap={1}>
      <Box gap={1}>
        <Text color={theme.warning as Color}>△</Text>
        <Text bold>Permission required</Text>
      </Box>

      <Box paddingLeft={2} flexDirection="column">
        <Text color={theme.text as Color}>
          {request.permission === "bash"
            ? `Run command: ${(request.metadata as any).command}`
            : request.permission === "edit"
              ? `Edit file: ${normalizePath((request.metadata as any).filepath)}`
              : `Allow tool: ${request.permission}`}
        </Text>
      </Box>

      <Box gap={2} marginTop={1}>
        {options.map((opt) => (
          // @ts-expect-error: key prop
          <Box key={opt} paddingX={1} backgroundColor={selected === opt ? (theme.warning as Color) : undefined}>
            <Text color={(selected === opt ? theme.background : theme.textMuted) as Color}>
              {opt === "once" ? "Allow once" : opt === "always" ? "Allow always" : "Reject"}
            </Text>
          </Box>
        ))}
      </Box>
    </ThemedBox>
  )
}
