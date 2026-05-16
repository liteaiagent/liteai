import { type Color, Text } from "@liteai/ink"
import { useMemo, useState } from "react"
import { filter, flatMap, map, pipe, sortBy } from "remeda"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import type { SelectItem } from "../primitives/types"
import { selectProviders, useAppState } from "../state"
import { SelectPane } from "../ui/select-pane"

/**
 * DialogManageModels — model visibility management.
 *
 * Lists ALL models (including hidden) grouped by provider, with toggle
 * indicators showing current visibility state. Enter toggles visibility.
 * Mirrors the web's "Manage Models" dialog (settings-models.tsx / dialog-manage-models.tsx).
 */
export function DialogManageModels(props: { onBack?: () => void; onClose?: () => void }) {
  const local = useLocal()
  const providers = useAppState(selectProviders())
  const { theme } = useTheme()
  const [query, setQuery] = useState("")

  const options = useMemo(() => {
    const needle = query.trim()

    const allModels = pipe(
      providers,
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
              key: `${provider.id}:${modelID}`,
              value: { providerID: provider.id, modelID },
              label: info.name ?? modelID,
              category: provider.name,
              disabled: false,
              footer: (
                <Text color={(isVisible ? theme.success : theme.textMuted) as Color} bold={isVisible}>
                  {isVisible ? "[✓]" : "[ ]"}
                </Text>
              ),
            } as SelectItem<{ providerID: string; modelID: string }>
          }),
        ),
      ),
    )

    if (needle) {
      const lower = needle.toLowerCase()
      return allModels.filter(
        (item) => item.label.toLowerCase().includes(lower) || (item.category ?? "").toLowerCase().includes(lower),
      )
    }

    return allModels
  }, [query, providers, local.model, theme])

  return (
    <SelectPane<{ providerID: string; modelID: string }>
      title="Manage Models"
      placeholder="Filter models..."
      items={options}
      skipFilter={true}
      onFilter={setQuery}
      onSelect={(item) => local.model.setVisibility(item.value, !local.model.visible(item.value))}
      onClose={props.onBack}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Enter toggle · Esc back</Text>}
    />
  )
}
