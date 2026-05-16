/**
 * DialogConfig — Claude Code-style tabbed settings pane.
 *
 * Replaces the legacy DialogSettings hub. Provides two tabs:
 *  - Status: system diagnostics (MCP, LSP, formatters)
 *  - Config: searchable settings list with sub-menu navigation
 *
 * Rendered via modalPane.openModal() from the /config or /settings commands.
 */

import { type Color, Text } from "@liteai/ink"
import { useMemo, useState } from "react"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useTuiConfig } from "../context/tui-config"
import { useNavigation } from "../hooks/use-navigation"
import { useKeybindings } from "../keybindings/use-keybinding"
import type { SelectItem } from "../primitives/types"
import { selectProviders, useAppState } from "../state"
import { SelectPane } from "../ui/select-pane"
import { Tab, Tabs } from "../ui/tabs"
import { DialogMcp } from "./dialog-mcp"
import { DialogModel } from "./dialog-model"
import { DialogPlugin } from "./dialog-plugin"
import { DialogProvider } from "./dialog-provider"
import { DialogStatus } from "./dialog-status"
import { DialogTheme } from "./dialog-theme"

type Props = {
  onClose: () => void
  defaultTab?: "Status" | "Config"
}

export function DialogConfig(props: Props) {
  const { theme } = useTheme()
  const [selectedTab, setSelectedTab] = useState(props.defaultTab ?? "Config")

  useKeybindings(
    {
      "select:cancel": props.onClose,
    },
    { context: "Tabs" },
  )

  return (
    <Tabs selectedTab={selectedTab} onTabChange={setSelectedTab as (tab: string) => void} color={theme.primary}>
      <Tab title="Status">
        <DialogStatus onClose={props.onClose} />
      </Tab>
      <Tab title="Config">
        <ConfigTab onClose={props.onClose} />
      </Tab>
    </Tabs>
  )
}

// ---------------------------------------------------------------------------
// Config tab — searchable settings list with sub-menu navigation
// ---------------------------------------------------------------------------

function ConfigTab({ onClose }: { onClose: () => void }) {
  const navigation = useNavigation()
  const config = useTuiConfig()
  const local = useLocal()
  const toast = useToast()
  const { theme } = useTheme()
  const providers = useAppState(selectProviders())
  const providerConnected = useAppState((s) => s.provider_next.connected)
  const mcpStatus = useAppState((s) => s.mcp)

  const currentModel = local.model.current()
  const currentProvider = currentModel ? providers.find((p) => p.id === currentModel.providerID) : undefined
  const currentModelName = currentModel
    ? (currentProvider?.models[currentModel.modelID]?.name ?? currentModel.modelID)
    : "Not set"

  // Map config setting IDs to navigation actions
  const actionMap = useMemo<Record<string, () => void>>(
    () => ({
      model: () => navigation.open(<DialogModel onClose={onClose} />),
      provider: () => navigation.open(<DialogProvider onClose={onClose} />),
      theme: () => navigation.open(<DialogTheme onClose={onClose} />),
      errorVerbosity: () => {
        const next = config.errorVerbosity === "low" ? "full" : "low"
        config.update({ errorVerbosity: next })
        toast.show({ variant: "success", message: `Error verbosity: ${next}` })
      },
      diff_style: () => {
        const next = config.diff_style === "stacked" ? "auto" : "stacked"
        config.update({ diff_style: next })
        toast.show({ variant: "success", message: `Diff style: ${next}` })
      },
      mcp: () => navigation.open(<DialogMcp onClose={onClose} />),
      plugins: () => navigation.open(<DialogPlugin onClose={onClose} />),
      status: () => navigation.open(<DialogStatus onClose={onClose} />),
    }),
    [navigation, onClose, config, toast],
  )

  const options: SelectItem<string>[] = useMemo(
    () => [
      // --- Session ---
      {
        key: "model",
        value: "model",
        label: "Model",
        description: currentModelName,
        category: "Session",
      },
      {
        key: "provider",
        value: "provider",
        label: "Providers",
        description: `${providerConnected.length} connected`,
        category: "Session",
      },

      // --- Appearance ---
      {
        key: "theme",
        value: "theme",
        label: "Theme",
        description: config.theme ?? "default",
        category: "Appearance",
      },
      {
        key: "errorVerbosity",
        value: "errorVerbosity",
        label: "Error Verbosity",
        description: config.errorVerbosity ?? "full",
        category: "Appearance",
      },
      {
        key: "diff_style",
        value: "diff_style",
        label: "Diff Style",
        description: config.diff_style ?? "auto",
        category: "Appearance",
      },

      // --- Configuration ---
      {
        key: "mcp",
        value: "mcp",
        label: "MCP Servers",
        description: `${Object.keys(mcpStatus).length} servers`,
        category: "Configuration",
      },
      {
        key: "plugins",
        value: "plugins",
        label: "Plugins",
        category: "Configuration",
      },

      // --- Diagnostics ---
      {
        key: "status",
        value: "status",
        label: "System Status",
        description: "MCP, LSP, formatters",
        category: "Diagnostics",
      },
    ],
    [currentModelName, providerConnected.length, config.theme, config.errorVerbosity, config.diff_style, mcpStatus],
  )

  return (
    <SelectPane<string>
      title="Config"
      placeholder="Search settings..."
      items={options}
      onSelect={(item) => actionMap[item.value]?.()}
      onClose={onClose}
      footerContent={
        <Text color={theme.textMuted as Color}>↑↓ navigate · Enter open · ← → switch tabs · Esc close</Text>
      }
    />
  )
}
