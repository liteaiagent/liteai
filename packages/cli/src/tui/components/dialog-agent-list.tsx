import { Box, type Color, Text } from "@liteai/ink"
import type { Agent } from "@liteai/sdk"
import { useMemo, useState } from "react"
import { useDialog } from "../context/dialog"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useKeybindings } from "../keybindings/use-keybinding"
import { DialogSelect } from "../ui/dialog-select"
import { DialogAgentDetail } from "./dialog-agent-detail"
import { DialogAgentEditor } from "./dialog-agent-editor"

export function DialogAgentList({ onClose: _onClose }: { onClose: () => void }) {
  const local = useLocal()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()

  const agents = local.agent.list()
  const [hovered, setHovered] = useState<Agent | null>(null)

  const options = useMemo(() => {
    const list = []

    for (const agent of agents) {
      if (agent.hidden) continue

      const toolCount = Array.isArray(agent.tools)
        ? agent.tools.length
        : typeof agent.tools === "object"
          ? Object.keys(agent.tools).length
          : 0

      list.push({
        value: agent,
        title: agent.name,
        description: `${agent.model?.modelID || "default"} · ${toolCount} tool(s)`,
        category: agent.native ? "Built-in" : "Custom",
        disabled: false,
        onSelect: () => dialog.push(() => <DialogAgentDetail agent={agent as Agent} />),
      })
    }
    return list
  }, [agents, dialog])

  useKeybindings(
    {
      "agent:create": () => {
        dialog.push(() => <DialogAgentEditor />)
      },
      "select:delete": async () => {
        if (!hovered) return
        if (hovered.native) {
          toast.show({ variant: "error", message: "Cannot delete built-in agent" })
          return
        }
        try {
          await sdk.client.project.agent.delete({ projectID: sdk.projectID, name: hovered.name } as Parameters<
            typeof sdk.client.project.agent.delete
          >[0])
          toast.show({ variant: "success", message: `Agent '${hovered.name}' deleted` })
        } catch (err: unknown) {
          toast.show({ variant: "error", message: (err as Error).message || "Failed to delete agent" })
        }
      },
    },
    { context: "Select" },
  )

  const footer = (
    <Box gap={2}>
      <Text color={theme.textMuted as Color}>Enter select</Text>
      <Text color={theme.textMuted as Color}>meta+n create</Text>
      <Text color={theme.textMuted as Color}>ctrl+d delete</Text>
    </Box>
  )

  return (
    <DialogSelect
      title="Manage Agents"
      current={local.agent.current()}
      options={options}
      footerContent={footer}
      onMove={(opt) => setHovered(opt.value)}
    />
  )
}
