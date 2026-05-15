import { Box, type Color, Text } from "@liteai/ink"
import type { Agent } from "@liteai/sdk"
import { useTheme } from "../context/theme"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"
import { DialogAgentEditor } from "./dialog-agent-editor"

function LabelValue({ label, value }: { label: string; value: string | React.ReactNode }) {
  const { theme } = useTheme()
  return (
    <Box flexDirection="row" gap={2}>
      <Box width={15}>
        <Text color={theme.textMuted as Color}>{label}</Text>
      </Box>
      <Box flexGrow={1}>{typeof value === "string" ? <Text color={theme.text as Color}>{value}</Text> : value}</Box>
    </Box>
  )
}

export function DialogAgentDetail({
  agent,
  onBack,
  onEdit,
}: {
  agent: Agent
  onBack?: () => void
  onEdit?: () => void
}) {
  const { theme } = useTheme()
  useRegisterKeybindingContext("Confirmation")

  useKeybindings(
    {
      "confirm:no": () => onBack?.(),
      "confirm:yes": () => {
        if (!agent.native) {
          onEdit?.()
        }
      },
    },
    { context: "Confirmation" },
  )

  const toolCount = Array.isArray(agent.tools)
    ? agent.tools.length
    : typeof agent.tools === "object"
      ? Object.keys(agent.tools).length
      : 0

  return (
    <Box flexDirection="column" gap={1} paddingBottom={1} paddingLeft={4} paddingRight={4}>
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text color={theme.text as Color} bold>
          Agent Detail
        </Text>
        <Text color={theme.textMuted as Color}>esc</Text>
      </Box>

      <Box flexDirection="column" gap={1} borderStyle="round" borderColor="ansi:blue" paddingX={2} paddingY={1}>
        <LabelValue label="Name" value={agent.name} />
        <LabelValue label="Description" value={agent.description || "N/A"} />
        <LabelValue label="Mode" value={agent.mode || "all"} />
        <LabelValue
          label="Model"
          value={
            typeof agent.model === "string" ? agent.model : (agent.model as { modelID?: string })?.modelID || "default"
          }
        />
        <LabelValue label="Tools" value={`${toolCount} tools configured`} />
        <LabelValue label="Permission" value={agent.permissionMode || "default"} />
        <LabelValue
          label="Temperature"
          value={agent.temperature !== undefined ? agent.temperature.toString() : "default"}
        />

        <Box marginTop={1} flexDirection="column">
          <Text color={theme.textMuted as Color}>Prompt (first 5 lines):</Text>
          <Box paddingLeft={2} paddingTop={1}>
            <Text dim>
              {agent.prompt
                ? agent.prompt.split("\n").slice(0, 5).join("\n") + (agent.prompt.split("\n").length > 5 ? "\n..." : "")
                : "N/A"}
            </Text>
          </Box>
        </Box>
      </Box>

      <Box flexDirection="row" gap={2} marginTop={1}>
        {!agent.native && <Text color={theme.textMuted as Color}>Enter edit</Text>}
        <Text color={theme.textMuted as Color}>Esc back</Text>
      </Box>
    </Box>
  )
}
