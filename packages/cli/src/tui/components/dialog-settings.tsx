import { type Color, Text } from "@liteai/ink"
import { useMemo } from "react"
import { useDialog } from "../context/dialog"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useTuiConfig } from "../context/tui-config"
import type { DialogSelectOption } from "../ui/dialog-select"
import { DialogSelect } from "../ui/dialog-select"
import { DialogManageModels } from "./dialog-manage-models"
import { DialogMcp } from "./dialog-mcp"
import { DialogModel } from "./dialog-model"
import { DialogPlugin } from "./dialog-plugin"
import { DialogProvider } from "./dialog-provider"
import { DialogSkill } from "./dialog-skill"
import { DialogStatus } from "./dialog-status"
import { DialogTheme } from "./dialog-theme"

/**
 * DialogSettings — configuration hub for the CLI TUI.
 *
 * Acts as the central entry point for all configuration surfaces,
 * mirroring the web's settings dialog with its tabbed layout.
 * Each entry pushes a sub-dialog onto the dialog stack, with
 * Esc navigating back to this hub.
 */

type SettingsEntry = {
  id: string
  title: string
  description: string
  category: string
}

export function DialogSettings() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const toast = useToast()

  const SETTINGS_ENTRIES: SettingsEntry[] = [
    { id: "models", title: "Models", description: "Switch the active model", category: "Session" },
    { id: "manage-models", title: "Manage Models", description: "Enable or disable models", category: "Configuration" },
    { id: "providers", title: "Providers", description: "Connect or disconnect providers", category: "Configuration" },
    {
      id: "mcp",
      title: "MCP Servers",
      description: "Manage Model Context Protocol servers",
      category: "Configuration",
    },
    { id: "plugins", title: "Plugins", description: "Manage installed plugins", category: "Configuration" },
    { id: "skills", title: "Skills", description: "Browse available skills", category: "Configuration" },
    { id: "theme", title: "Theme", description: "Change color theme", category: "Appearance" },
    {
      id: "verbosity",
      title: "Error Verbosity",
      description: `Toggle error verbosity (current: ${config.errorVerbosity || "full"})`,
      category: "Appearance",
    },
    { id: "status", title: "Status", description: "View system status", category: "Diagnostics" },
  ]

  const options: DialogSelectOption<string>[] = useMemo(
    () =>
      SETTINGS_ENTRIES.map((entry) => ({
        value: entry.id,
        title: entry.title,
        description: entry.description,
        category: entry.category,
        disabled: false,
        onSelect: () => {
          const handlers: Record<string, () => void> = {
            models: () => dialog.push(() => <DialogModel />),
            "manage-models": () => dialog.push(() => <DialogManageModels onBack={() => dialog.pop()} />),
            providers: () => dialog.push(() => <DialogProvider />),
            mcp: () => dialog.push(() => <DialogMcp />),
            plugins: () => dialog.push(() => <DialogPlugin />),
            skills: () => dialog.push(() => <DialogSkill onSelect={() => dialog.pop()} />),
            theme: () => dialog.push(() => <DialogTheme />),
            verbosity: () => {
              const next = config.errorVerbosity === "low" ? "full" : "low"
              config.update({ errorVerbosity: next })
              toast.show({ variant: "success", message: `Error verbosity set to ${next}` })
              dialog.pop()
            },
            status: () => dialog.push(() => <DialogStatus />),
          }
          handlers[entry.id]?.()
        },
      })),
    [dialog, config],
  )

  return (
    <DialogSelect<string>
      title="Settings"
      placeholder="Search settings..."
      options={options}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Enter open · Esc close</Text>}
    />
  )
}
