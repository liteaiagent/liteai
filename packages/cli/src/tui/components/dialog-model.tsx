import { type Color, Text } from "@liteai/ink"
import fuzzysort from "fuzzysort"
import { useMemo, useState } from "react"
import { filter, flatMap, map, pipe, sortBy } from "remeda"
import { useDialog } from "../context/dialog"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useKeybindings } from "../keybindings/use-keybinding"
import type { DialogSelectOption } from "../ui/dialog-select"
import { DialogSelect } from "../ui/dialog-select"
import { DialogProvider, useDialogProviderOptions } from "./dialog-provider"

export function useConnected() {
  const sync = useSync()
  return useMemo(() => {
    return sync.provider.some(
      (x) => x.id !== "google-code-assist" || Object.values(x.models).some((y) => y.cost?.input !== 0),
    )
  }, [sync.provider])
}

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [query, setQuery] = useState("")
  const [selectedOption, setSelectedOption] = useState<any>()

  const connected = useConnected()
  const providers = useDialogProviderOptions()

  const showExtra = connected && !props.providerID

  const options = useMemo(() => {
    const needle = query.trim()
    const showSections = showExtra && needle.length === 0
    const favorites = connected ? local.model.favorite() : []
    const recents = local.model.recent()

    const favoriteSet = new Set(favorites.map((item) => `${item.providerID}:${item.modelID}`))
    const recentSet = new Set(recents.map((item) => `${item.providerID}:${item.modelID}`))

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        // Respect visibility — hidden models don't appear in picker
        if (!local.model.visible({ providerID: provider.id, modelID: model.id })) return []
        return [
          {
            value: { providerID: provider.id, modelID: model.id },
            title: model.name ?? item.modelID,
            description: provider.name,
            category,
            disabled: false,
            footer: model.cost?.input === 0 && provider.id === "google-code-assist" ? "Free" : undefined,
            onSelect: () => {
              dialog.clear()
              local.model.set({ providerID: provider.id, modelID: model.id }, { recent: true })
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const providerOptions = pipe(
      sync.provider,
      sortBy(
        (provider) => (provider.id !== "google-code-assist" ? 1 : 0),
        (provider) => provider.name,
      ),
      flatMap((provider) => {
        return pipe(
          Object.entries(provider.models),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, _info]) => (props.providerID ? provider.id === props.providerID : true)),
          // Respect visibility — hidden models don't appear in picker
          filter(([modelID]) => local.model.visible({ providerID: provider.id, modelID })),
          map(
            ([model, info]) =>
              ({
                value: { providerID: provider.id, modelID: model },
                title: info.name ?? model,
                // Show ★ for favorites, ↺ for recents in the provider section
                description: favoriteSet.has(`${provider.id}:${model}`) ? "★" : undefined,
                category: connected ? provider.name : undefined,
                disabled: false,
                footer: info.cost?.input === 0 && provider.id === "google-code-assist" ? "Free" : undefined,
                // Gutter indicator for recent models in provider section
                gutter: recentSet.has(`${provider.id}:${model}`) ? (
                  <Text color={theme.textMuted as Color}>↺</Text>
                ) : undefined,
                onSelect() {
                  dialog.clear()
                  local.model.set({ providerID: provider.id, modelID: model }, { recent: true })
                },
              }) as DialogSelectOption<{ providerID: string; modelID: string }>,
          ),
          // Bug 1 fix: Do NOT filter out models that appear in favorites/recents.
          // They now appear in BOTH their provider section AND the special sections,
          // with ★/↺ indicators to show their status.
          sortBy(
            (x) => (x.footer !== "Free" ? 1 : 0),
            (x) => x.title,
          ),
        )
      }),
    )

    const popularProviders = !connected
      ? providers
          .map((option) => ({
            ...option,
            value: { providerID: option.value, modelID: "" }, // Type coercion
            category: "Popular providers",
          }))
          .slice(0, 6)
      : []

    if (needle) {
      return [
        ...fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  }, [query, showExtra, connected, local.model, sync.provider, props.providerID, providers, dialog, theme])

  const provider = props.providerID ? sync.provider.find((x) => x.id === props.providerID) : null
  const title = provider?.name ?? "Select model"

  useKeybindings(
    {
      "model:providerList": () => {
        dialog.replace(() => <DialogProvider />)
      },
      "model:favoriteToggle": () => {
        if (selectedOption && connected) {
          local.model.toggleFavorite(selectedOption.value)
        }
      },
    },
    { context: "Select" },
  )

  return (
    <DialogSelect<{ providerID: string; modelID: string }>
      options={options}
      onFilter={setQuery}
      skipFilter={true}
      title={title}
      current={local.model.current()}
      onMove={setSelectedOption}
      footerContent={
        <Text color={theme.textMuted as Color}>↑↓ navigate · Enter select · ctrl+a providers · ctrl+f favorite</Text>
      }
    />
  )
}
