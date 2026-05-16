/**
 * CommandPalette — fuzzy command launcher dialog (ctrl+p).
 *
 * Lists all available TUI commands with their keybinding hints.
 * Uses the standard SelectPane pattern with fuzzy search.
 *
 * On selection, the palette closes and dispatches the command
 * directly through the command interceptors (same path as typing
 * the slash command in the prompt).
 *
 * @module components/command-palette
 */

import type { Color } from "@liteai/ink"
import { Text } from "@liteai/ink"
import { useMemo } from "react"
import { useTheme } from "../context/theme"
import type { SelectItem } from "../primitives/types"
import { getCommandCategory, getCommandKeybinding } from "../state/command-registry"
import { SelectPane } from "../ui/select-pane"
import { TUI_COMMANDS } from "./prompt/prompt-input"

interface CommandPaletteProps {
  /** Called when the palette should close (esc or after command selection). */
  onClose: () => void
  /** Called when a command is selected. Receives the command name (e.g., "models"). */
  onSelect: (commandName: string) => void
}

export function CommandPalette({ onClose, onSelect }: CommandPaletteProps) {
  const { theme } = useTheme()

  const items = useMemo<SelectItem<string>[]>(() => {
    return TUI_COMMANDS.map((cmd) => {
      const keybinding = getCommandKeybinding(cmd.name)
      return {
        key: cmd.name,
        value: cmd.name,
        label: `/${cmd.name}`,
        description: cmd.description,
        category: getCommandCategory(cmd.name),
        disabled: false,
        footer: keybinding ? <Text color={theme.textMuted as Color}>{keybinding}</Text> : undefined,
      }
    })
  }, [theme])

  return (
    <SelectPane<string>
      title="Command Palette"
      items={items}
      placeholder="Search commands..."
      onSelect={(item) => {
        onSelect(item.value)
      }}
      onClose={onClose}
      flat={true}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Enter run · / filter · esc close</Text>}
    />
  )
}
