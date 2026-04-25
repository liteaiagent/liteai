/** @jsxImportSource react */
import fuzzysort from "fuzzysort"
import { useMemo, useState } from "react"
import { filter, flatMap, map, pipe, sortBy } from "remeda"
import { useDialog } from "../context/dialog"
import { useKeybind } from "../context/keybind"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
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
  const keybind = useKeybind()
  const [query, setQuery] = useState("")

  const connected = useConnected()
  const providers = useDialogProviderOptions()

  const showExtra = connected && !props.providerID

  const options = useMemo(() => {
    const needle = query.trim()
    const showSections = showExtra && needle.length === 0
    const favorites = connected ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
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
          map(
            ([model, info]) =>
              ({
                value: { providerID: provider.id, modelID: model },
                title: info.name ?? model,
                description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
                  ? "(Favorite)"
                  : undefined,
                category: connected ? provider.name : undefined,
                disabled: false,
                footer: info.cost?.input === 0 && provider.id === "google-code-assist" ? "Free" : undefined,
                onSelect() {
                  dialog.clear()
                  local.model.set({ providerID: provider.id, modelID: model }, { recent: true })
                },
              }) as DialogSelectOption<{ providerID: string; modelID: string }>,
          ),
          filter((x) => {
            if (!showSections) return true
            if (favorites.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
            if (recents.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
            return true
          }),
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
  }, [query, showExtra, connected, local.model, sync.provider, props.providerID, providers, dialog])

  const provider = props.providerID ? sync.provider.find((x) => x.id === props.providerID) : null
  const title = provider?.name ?? "Select model"

  return (
    <DialogSelect<{ providerID: string; modelID: string }>
      options={options}
      keybind={[
        {
          keybind: keybind.all.model_provider_list?.[0],
          title: connected ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: keybind.all.model_favorite_toggle?.[0],
          title: "Favorite",
          disabled: !connected,
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value)
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title}
      current={local.model.current()}
    />
  )
}
