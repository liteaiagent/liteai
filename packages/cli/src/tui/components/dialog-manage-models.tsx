import { type Color, Text } from "@liteai/ink"
import { useMemo, useState } from "react"
import { filter, flatMap, map, pipe, sortBy } from "remeda"
import { useDialog } from "../context/dialog"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import type { DialogSelectOption } from "../ui/dialog-select"
import { DialogSelect } from "../ui/dialog-select"

/**
 * DialogManageModels — model visibility management.
 *
 * Lists ALL models (including hidden) grouped by provider, with toggle
 * indicators showing current visibility state. Enter toggles visibility.
 * Mirrors the web's "Manage Models" dialog (settings-models.tsx / dialog-manage-models.tsx).
 */
export function DialogManageModels(props: { onBack?: () => void }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [query, setQuery] = useState("")

  const options = useMemo(() => {
    const needle = query.trim()

    const allModels = pipe(
      sync.provider,
      sortBy(
        (provider) => (provider.id !== "google-code-assist" ? 1 : 0),
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          Object.entries(provider.models),
          filter(([_, info]) => info.status !== "deprecated"),
          sortBy(([_, info]) => info.name ?? ""),
          map(([modelID, info]) => {
            const isVisible = local.model.visible({ providerID: provider.id, modelID })
            return {
              value: { providerID: provider.id, modelID },
              title: info.name ?? modelID,
              category: provider.name,
              disabled: false,
              footer: (
                <Text color={(isVisible ? theme.success : theme.textMuted) as Color} bold={isVisible}>
                  {isVisible ? "[✓]" : "[ ]"}
                </Text>
              ),
              onSelect: () => {
                local.model.setVisibility({ providerID: provider.id, modelID }, !isVisible)
              },
            } as DialogSelectOption<{ providerID: string; modelID: string }>
          }),
        ),
      ),
    )

    if (needle) {
      // Simple filter by title/category since we manage skipFilter ourselves
      const lower = needle.toLowerCase()
      return allModels.filter(
        (opt) => opt.title.toLowerCase().includes(lower) || (opt.category ?? "").toLowerCase().includes(lower),
      )
    }

    return allModels
  }, [query, sync.provider, local.model, theme, dialog])

  return (
    <DialogSelect<{ providerID: string; modelID: string }>
      title="Manage Models"
      placeholder="Filter models..."
      options={options}
      skipFilter={true}
      onFilter={setQuery}
      keybind={[]}
      onEscape={props.onBack}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Enter toggle · Esc back</Text>}
    />
  )
}
