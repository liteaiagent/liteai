import { type Color, Text } from "@liteai/ink"
import fuzzysort from "fuzzysort"
import { useMemo, useState } from "react"
import { filter, flatMap, map, pipe, sortBy } from "remeda"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useNavigation } from "../hooks/use-navigation"
import { useKeybindings } from "../keybindings/use-keybinding"
import type { SelectItem } from "../primitives/types"
import { selectProviders, useAppState } from "../state"
import { LocalMessageStore } from "../state/local-messages"
import { SessionTabStore } from "../state/session-tab-store"
import { SelectPane } from "../ui/select-pane"
import { DialogProvider, useProviderDisplayOptions } from "./dialog-provider"

export function useConnected() {
  const connected = useAppState((s) => s.provider_next.connected)
  return connected.length > 0
}

type Props = {
  providerID?: string
  onClose: () => void
}

export function DialogModel(props: Props) {
  const local = useLocal()
  const availableProviders = useAppState(selectProviders())
  const syncConnected = useAppState((s) => s.provider_next.connected)
  const navigation = useNavigation()
  const { theme } = useTheme()
  const [query, setQuery] = useState("")
  const [selectedOption, setSelectedOption] = useState<
    SelectItem<{ providerID: string; modelID: string }> | undefined
  >()

  const connected = useConnected()
  const providers = useProviderDisplayOptions()

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
        const provider = availableProviders.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        if (!local.model.visible({ providerID: provider.id, modelID: model.id })) return []
        return [
          {
            key: `${provider.id}:${model.id}`,
            value: { providerID: provider.id, modelID: model.id },
            label: model.name ?? item.modelID,
            description: provider.name,
            category,
            disabled: false,
            footer: model.cost?.input === 0 && provider.id === "google-code-assist" ? "Free" : undefined,
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
      availableProviders,
      filter((provider) => (props.providerID ? provider.id === props.providerID : syncConnected.includes(provider.id))),
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
                key: `${provider.id}:${model}`,
                value: { providerID: provider.id, modelID: model },
                label: info.name ?? model,
                // Show ★ for favorites, ↺ for recents in the provider section
                description: favoriteSet.has(`${provider.id}:${model}`) ? "★" : undefined,
                category: connected ? provider.name : undefined,
                disabled: false,
                footer: info.cost?.input === 0 && provider.id === "google-code-assist" ? "Free" : undefined,
                // Gutter indicator for recent models in provider section
                gutter: recentSet.has(`${provider.id}:${model}`) ? (
                  <Text color={theme.textMuted as Color}>↺</Text>
                ) : undefined,
              }) as SelectItem<{ providerID: string; modelID: string }>,
          ),
          // Bug 1 fix: Do NOT filter out models that appear in favorites/recents.
          // They now appear in BOTH their provider section AND the special sections,
          // with ★/↺ indicators to show their status.
          sortBy(
            (x) => (x.footer !== "Free" ? 1 : 0),
            (x) => x.label,
          ),
        )
      }),
    )

    const popularProviders = !connected
      ? providers
          .map((option) => ({
            key: `provider:${option.value}`,
            value: { providerID: option.value, modelID: "" } as { providerID: string; modelID: string },
            label: option.label ?? option.value,
            category: "Connect a provider",
          }))
          .slice(0, 6)
      : []

    if (needle) {
      return [
        ...fuzzysort.go(needle, providerOptions, { keys: ["label", "category"] }).map((x) => x.obj),
        ...fuzzysort.go(needle, popularProviders, { keys: ["label"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  }, [
    query,
    showExtra,
    connected,
    local.model,
    availableProviders,
    props.providerID,
    providers,
    navigation,
    theme,
    props.onClose,
  ])

  const provider = props.providerID ? availableProviders.find((x) => x.id === props.providerID) : null
  const title = provider?.name ?? "Select model"

  useKeybindings(
    {
      "model:providerList": () => {
        navigation.open(<DialogProvider onClose={navigation.close} />)
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
    <SelectPane<{ providerID: string; modelID: string }>
      items={options}
      onFilter={setQuery}
      skipFilter={true}
      title={title}
      current={local.model.current()}
      onHighlight={setSelectedOption}
      onSelect={(item) => {
        props.onClose()
        local.model.set(item.value, { recent: true })
        // Record trail message for model change
        if (item.value.modelID) {
          const activeSession = SessionTabStore.getActiveSessionID()
          if (activeSession) {
            LocalMessageStore.add(activeSession, "model-change", `/model \u2192 ${item.label}`)
          }
        }
        // If this is a provider-only entry (popular providers when disconnected), open provider dialog
        if (!item.value.modelID) {
          navigation.open(<DialogProvider onClose={navigation.close} />)
        }
      }}
      onClose={props.onClose}
      footerContent={
        <Text color={theme.textMuted as Color}>↑↓ navigate · Enter select · ctrl+a providers · ctrl+f favorite</Text>
      }
    />
  )
}
