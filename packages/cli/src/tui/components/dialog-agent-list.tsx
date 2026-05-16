import { Box, type Color, Text } from "@liteai/ink"
import type { Agent } from "@liteai/sdk"
import { useMemo, useState } from "react"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useKeybindings } from "../keybindings/use-keybinding"
import { SelectPane } from "../ui/select-pane"
import { DialogAgentDetail } from "./dialog-agent-detail"
import { DialogAgentEditor } from "./dialog-agent-editor"

export function DialogAgentList({ onClose: _onClose }: { onClose: () => void }) {
  const local = useLocal()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()

  const agents = local.agent.list()
  const [hovered, setHovered] = useState<Agent | null>(null)

  type ViewState = { type: "list" } | { type: "detail"; agent: Agent } | { type: "editor"; agent?: Agent }

  const [view, setView] = useState<ViewState>({ type: "list" })

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
        key: agent.name,
        value: agent,
        label: agent.name,
        description: `${agent.model?.modelID || "default"} · ${toolCount} tool(s)`,
        category: agent.native ? "Built-in" : "Custom",
        disabled: false,
      })
    }
    return list
  }, [agents])

  useKeybindings(
    {
      "agent:create": () => {
        setView({ type: "editor" })
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

  if (view.type === "detail") {
    return (
      <DialogAgentDetail
        agent={view.agent}
        onBack={() => setView({ type: "list" })}
        onEdit={() => setView({ type: "editor", agent: view.agent })}
      />
    )
  }

  if (view.type === "editor") {
    return (
      <DialogAgentEditor
        agent={view.agent}
        onBack={() => setView({ type: "list" })}
        onClose={() => setView({ type: "list" })}
      />
    )
  }

  return (
    <SelectPane
      title="Manage Agents"
      current={local.agent.current()}
      items={options}
      footerContent={footer}
      onHighlight={(item) => setHovered(item.value)}
      onSelect={(item) => setView({ type: "detail", agent: item.value as Agent })}
      onClose={_onClose}
    />
  )
}
