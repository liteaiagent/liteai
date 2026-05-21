import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type { PermissionRequest } from "@liteai/sdk"
import { useState } from "react"
import ThemedBox from "../../components/design-system/ThemedBox"
import { useSDK } from "../../context/sdk"
import { useTheme } from "../../context/theme"
import { useRegisterKeybindingContext } from "../../keybindings/keybinding-context"
import { useKeybindings } from "../../keybindings/use-keybinding"
import { normalizePath } from "./utils"

function getPermissionHeader(request: PermissionRequest): { icon: string; label: string } {
  switch (request.permission) {
    case "bash":
      return { icon: "△", label: "? Shell" }
    case "edit":
      return { icon: "△", label: "? Edit File" }
    default:
      return { icon: "△", label: `? Tool: ${request.permission}` }
  }
}

function getPermissionDetail(request: PermissionRequest): string {
  if (request.permission === "bash") {
    return `${(request.metadata as { command?: string }).command ?? "unknown command"}`
  }
  if (request.permission === "edit") {
    return `${normalizePath((request.metadata as { filepath?: string }).filepath)}`
  }
  return `${request.permission}`
}

export function PermissionPrompt({ request }: { request: PermissionRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const [selected, setSelected] = useState<"once" | "always" | "reject">("once")

  const options = ["once", "always", "reject"] as const

  useRegisterKeybindingContext("Select")
  useKeybindings(
    {
      "select:previous": () => {
        const idx = options.indexOf(selected)
        setSelected(options[(idx - 1 + options.length) % options.length])
      },
      "select:next": () => {
        const idx = options.indexOf(selected)
        setSelected(options[(idx + 1) % options.length])
      },
      "select:accept": () => {
        sdk.client.project.permission.reply({
          projectID: sdk.projectID,
          reply: selected,
          requestID: request.id,
        })
      },
      "select:cancel": () => {
        sdk.client.project.permission.reply({
          projectID: sdk.projectID,
          reply: "reject",
          requestID: request.id,
        })
      },
    },
    { context: "Select" },
  )

  const header = getPermissionHeader(request)
  const detail = getPermissionDetail(request)
  const agentName = (request as PermissionRequest & { agentName?: string }).agentName

  return (
    <ThemedBox borderStyle="round" borderColor={theme.warning as Color} padding={1} flexDirection="column" gap={1}>
      <Box gap={1}>
        <Text color={theme.warning as Color}>{header.icon}</Text>
        <Text bold>{header.label}</Text>
        {agentName && <Text color={theme.primary as Color}>[{agentName}]</Text>}
      </Box>

      <Box paddingLeft={2} flexDirection="column">
        <Text color={theme.text as Color}>{detail}</Text>
      </Box>

      <Box gap={2} marginTop={1}>
        {options.map((opt) => (
          <Box key={opt} paddingX={1} backgroundColor={selected === opt ? (theme.warning as Color) : undefined}>
            <Text color={(selected === opt ? theme.background : theme.textMuted) as Color}>
              {opt === "once" ? "Allow once" : opt === "always" ? "Allow always" : "Reject"}
            </Text>
          </Box>
        ))}
      </Box>

      <Box gap={2} marginTop={0}>
        <Text color={theme.textMuted as Color}>←/→ select</Text>
        <Text color={theme.textMuted as Color}>enter confirm</Text>
        <Text color={theme.textMuted as Color}>esc reject</Text>
      </Box>
    </ThemedBox>
  )
}
