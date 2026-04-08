import { Button } from "@liteai/ui/button"
import { Switch } from "@liteai/ui/switch"
import { useParams } from "@solidjs/router"
import { type Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider } from "@/context/sync"
import { useScopedConfig } from "@/hooks/use-scoped-config"
import { toProjectID } from "@/utils/project-id"
import { SettingsList } from "./settings-list"
import { SettingsScopeSwitcher } from "./settings-scope-switcher"

type PluginEntry = {
  id: string
  name: string
  marketplace: string
  version?: string
  enabled: boolean
  scope: "user" | "project"
}

type MarketplaceEntry = {
  name: string
  source: { source: "github"; repo: string } | { source: "url"; url: string } | string
  added?: string
}

type MarketplacePlugin = {
  name: string
  description?: string
  version?: string
  author?: string
  tags?: string[]
  installs?: number
}

type PluginView = "list" | "discover" | "marketplaces" | { type: "marketplace"; name: string }

const SettingsPluginsInner: Component<{ projectID: string }> = (props) => {
  const sdk = useSDK()
  const [loading, setLoading] = createSignal<string | null>(null)
  const [view, setView] = createSignal<PluginView>("list")
  const [newMarketplaceSource, setNewMarketplaceSource] = createSignal("")
  const [addingMarketplace, setAddingMarketplace] = createSignal(false)
  const [marketplaceSearch, setMarketplaceSearch] = createSignal("")
  const [search, setSearch] = createSignal("")
  const { scope, setScope, getConfig, updateConfig } = useScopedConfig()
  const sync = useGlobalSync()

  const [plugins, { refetch: refetchPlugins }] = createResource(async () => {
    try {
      const { data } = await sdk.client.project.plugin.list({ projectID: sdk.projectID })
      return ((data ?? []) as PluginEntry[]).sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return [] as PluginEntry[]
    }
  })

  const [marketplaces, { refetch: refetchMarketplaces }] = createResource(async () => {
    try {
      const { data } = await sdk.client.project.plugin.marketplace.list({ projectID: sdk.projectID })
      return ((data ?? []) as MarketplaceEntry[]).sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return [] as MarketplaceEntry[]
    }
  })

  const currentMarketplace = createMemo(() => {
    const v = view()
    if (typeof v === "object" && v.type === "marketplace") return v.name
    return null
  })

  const [marketplacePlugins] = createResource(currentMarketplace, async (name) => {
    if (!name) return [] as MarketplacePlugin[]
    try {
      const { data } = await sdk.client.project.plugin.marketplace.plugins({
        name,
        projectID: sdk.projectID,
      })
      return (data ?? []) as MarketplacePlugin[]
    } catch {
      return [] as MarketplacePlugin[]
    }
  })

  const installedIds = createMemo(() => {
    const all = plugins() ?? []
    return new Set(all.map((p) => `${p.name}@${p.marketplace}`))
  })

  const filteredPlugins = createMemo(() => {
    const q = search().toLowerCase()
    const all = plugins() ?? []
    if (!q) return all
    return all.filter((p) => p.name.toLowerCase().includes(q) || p.marketplace.toLowerCase().includes(q))
  })

  const filteredMarketplacePlugins = createMemo(() => {
    const q = marketplaceSearch().toLowerCase()
    const all = marketplacePlugins() ?? []
    if (!q) return all
    return all.filter((p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
  })

  const enabledCount = createMemo(() => (plugins() ?? []).filter((p) => p.enabled).length)

  const toggle = async (id: string, on: boolean) => {
    if (loading()) return
    setLoading(id)
    try {
      const currentConfig = await getConfig(props.projectID)
      const enabledPlugins = { ...(currentConfig.enabledPlugins ?? {}) }
      if (scope() === "project") {
        enabledPlugins[id] = on
      } else {
        if (!on) {
          enabledPlugins[id] = false
        } else {
          // If enabling in user scope, we clear the disability
          enabledPlugins[id] = null as unknown as boolean
        }
      }
      await updateConfig({ enabledPlugins }, props.projectID)
      refetchPlugins()
    } finally {
      setLoading(null)
    }
  }

  const removePlugin = async (id: string) => {
    if (loading()) return
    setLoading(id)
    await sdk.client.project.plugin.uninstall({ id, projectID: props.projectID })
    refetchPlugins()
    setLoading(null)
  }

  const removeMarketplace = async (name: string) => {
    await sdk.client.project.plugin.marketplace.remove({ name, projectID: sdk.projectID })
    refetchMarketplaces()
  }

  const addMarketplace = async () => {
    const source = newMarketplaceSource().trim()
    if (!source) return
    setAddingMarketplace(true)
    await sdk.client.project.plugin.marketplace.add({ source, projectID: sdk.projectID })
    setAddingMarketplace(false)
    setNewMarketplaceSource("")
    refetchMarketplaces()
    setView("marketplaces")
  }

  const installPlugin = async (marketplace: string, pluginName: string) => {
    if (loading()) return
    setLoading(`${pluginName}@${marketplace}`)
    await sdk.client.project.plugin.marketplace.install({
      name: marketplace,
      plugin: pluginName,
      projectID: sdk.projectID,
    })
    refetchPlugins()
    setLoading(null)
  }

  const sourceLabel = (m: MarketplaceEntry) => {
    if (typeof m.source === "string") return m.source
    if ("repo" in m.source) return (m.source as { repo: string }).repo
    return (m.source as { url: string }).url
  }

  const activeView = createMemo(() => {
    const v = view()
    if (typeof v === "string") return v
    return "marketplace-detail"
  })

  return (
    <div
      class={`flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10 transition-opacity duration-300 ${loading() !== null ? "opacity-50 pointer-events-none" : ""}`}
    >
      {/* Header */}
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-4 max-w-[720px]">
          <div class="flex items-center gap-3">
            <Show when={activeView() !== "list"}>
              <button
                type="button"
                class="text-text-weak hover:text-text-strong text-sm"
                onClick={() => setView("list")}
              >
                ← Back
              </button>
            </Show>
            <h2 class="text-16-medium text-text-strong">Plugins</h2>
          </div>
          <div class="pb-2">
            <SettingsScopeSwitcher scope={scope} setScope={setScope} hasWorkspace={() => true} />
          </div>

          {/* Tab bar */}
          <div class="flex gap-4 mt-2 border-b border-border-weak-base">
            {(
              [
                ["list", "Installed"],
                ["discover", "Discover"],
                ["marketplaces", "Marketplaces"],
              ] as [string, string][]
            ).map(([v, label]) => (
              <button
                type="button"
                class={`pb-2 text-13-medium border-b-2 -mb-px transition-colors ${
                  activeView() === v
                    ? "border-primary text-text-strong"
                    : "border-transparent text-text-weak hover:text-text-strong"
                }`}
                onClick={() => setView(v as "list" | "discover" | "marketplaces")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Installed plugins */}
      <Show when={activeView() === "list"}>
        <div class="flex flex-col gap-4 max-w-[720px]">
          <p class="text-13-regular text-text-weak">
            {enabledCount()} of {(plugins() ?? []).length} plugins enabled
          </p>

          <input
            type="text"
            placeholder="Search plugins…"
            class="w-full px-3 py-2 rounded border border-border-weak-base bg-surface-base text-13-regular text-text-strong outline-none focus:border-primary mb-2"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />

          <Show
            when={(plugins() ?? []).length > 0}
            fallback={
              <SettingsList>
                <div class="py-8 text-14-regular text-text-weak text-center">
                  No plugins installed.{" "}
                  <button type="button" class="text-primary underline" onClick={() => setView("discover")}>
                    Browse the marketplace
                  </button>
                </div>
              </SettingsList>
            }
          >
            <SettingsList>
              <For each={filteredPlugins()}>
                {(plugin) => (
                  <div class="flex items-center justify-between gap-4 min-h-14 py-3 border-b border-border-weak-base last:border-none px-2">
                    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="text-14-medium text-text-strong truncate">{plugin.name}</span>
                        <span class="text-11-regular text-text-weaker">
                          {plugin.marketplace === "__local__" ? "local" : plugin.marketplace}
                        </span>
                        <Show when={plugin.version}>
                          <span class="text-11-regular text-text-weaker">v{plugin.version}</span>
                        </Show>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <Switch
                        checked={
                          scope() === "user" ? sync.data.config?.enabledPlugins?.[plugin.id] === true : plugin.enabled
                        }
                        disabled={loading() === plugin.id}
                        onChange={() => toggle(plugin.id, !plugin.enabled)}
                      />
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => removePlugin(plugin.id)}
                        disabled={loading() === plugin.id}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </SettingsList>
          </Show>
        </div>
      </Show>

      {/* Discover tab */}
      <Show when={activeView() === "discover"}>
        <Show
          when={(marketplaces() ?? []).length > 0}
          fallback={
            <div class="flex flex-col gap-4 max-w-[720px] py-8 text-center">
              <p class="text-14-regular text-text-weak">No marketplaces added yet.</p>
              <Button variant="primary" onClick={() => setView("marketplaces")}>
                Add a Marketplace
              </Button>
            </div>
          }
        >
          <div class="flex flex-col gap-4 max-w-[720px]">
            <div class="flex flex-wrap gap-2">
              <For each={marketplaces() ?? []}>
                {(m) => (
                  <button
                    type="button"
                    class={`px-3 py-1.5 rounded-full text-12-medium border transition-colors ${
                      currentMarketplace() === m.name
                        ? "border-primary text-primary bg-surface-base"
                        : "border-border-weak-base text-text-weak hover:border-primary hover:text-text-strong"
                    }`}
                    onClick={() => setView({ type: "marketplace", name: m.name })}
                  >
                    {m.name}
                  </button>
                )}
              </For>
            </div>

            <Show when={currentMarketplace()}>
              <input
                type="text"
                placeholder="Search plugins…"
                class="w-full px-3 py-2 rounded border border-border-weak-base bg-surface-base text-13-regular text-text-strong outline-none focus:border-primary"
                value={marketplaceSearch()}
                onInput={(e) => setMarketplaceSearch(e.currentTarget.value)}
              />

              <p class="text-13-regular text-text-weak">
                Discover plugins ({filteredMarketplacePlugins().length}/{(marketplacePlugins() ?? []).length})
              </p>

              <Show
                when={!marketplacePlugins.loading}
                fallback={<div class="py-8 text-14-regular text-text-weak text-center">Loading…</div>}
              >
                <SettingsList>
                  <For each={filteredMarketplacePlugins()}>
                    {(plugin) => {
                      const key = `${plugin.name}@${currentMarketplace()}`
                      const isInstalled = () => installedIds().has(key)
                      const isLoading = () => loading() === key

                      return (
                        <div class="flex items-center justify-between gap-4 min-h-14 py-3 border-b border-border-weak-base last:border-none px-2">
                          <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                              <span class="text-14-medium text-text-strong truncate">{plugin.name}</span>
                              <Show when={plugin.author}>
                                <span class="text-11-regular text-text-weaker">· {plugin.author}</span>
                              </Show>
                              <Show when={plugin.installs}>
                                <span class="text-11-regular text-text-weaker">
                                  · {plugin.installs?.toLocaleString()} installs
                                </span>
                              </Show>
                            </div>
                            <Show when={plugin.description}>
                              <span class="text-12-regular text-text-weak truncate">{plugin.description}</span>
                            </Show>
                            <Show when={plugin.tags?.length}>
                              <div class="flex gap-1 flex-wrap mt-0.5">
                                <For each={plugin.tags}>
                                  {(tag) => (
                                    <span class="text-10-regular px-1.5 py-0.5 rounded bg-surface-stronger text-text-weaker">
                                      {tag}
                                    </span>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                          <Button
                            variant={isInstalled() ? "secondary" : "primary"}
                            size="small"
                            disabled={isLoading() || isInstalled()}
                            onClick={() => installPlugin(currentMarketplace() ?? "", plugin.name)}
                          >
                            {isLoading() ? "Installing…" : isInstalled() ? "Installed" : "Install"}
                          </Button>
                        </div>
                      )
                    }}
                  </For>
                </SettingsList>
              </Show>
            </Show>

            <Show when={!currentMarketplace()}>
              <p class="text-13-regular text-text-weak">Select a marketplace above to browse its plugins.</p>
            </Show>
          </div>
        </Show>
      </Show>

      {/* Marketplaces tab */}
      <Show when={activeView() === "marketplaces"}>
        <div class="flex flex-col gap-4 max-w-[720px]">
          <p class="text-13-regular text-text-weak">Manage marketplaces</p>

          {/* Add marketplace form */}
          <SettingsList>
            <div class="flex flex-col gap-3 p-4 border-b border-border-weak-base">
              <span class="text-14-medium text-text-strong">Add Marketplace</span>
              <p class="text-12-regular text-text-weaker">
                Examples: <code>owner/repo</code> (GitHub), <code>https://example.com/marketplace.json</code>,{" "}
                <code>./path/to/marketplace</code>
              </p>
              <div class="flex gap-2">
                <input
                  type="text"
                  placeholder="owner/repo or https://…"
                  class="flex-1 px-3 py-2 rounded border border-border-weak-base bg-surface-base text-13-regular text-text-strong outline-none focus:border-primary"
                  value={newMarketplaceSource()}
                  onInput={(e) => setNewMarketplaceSource(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addMarketplace()
                  }}
                />
                <Button
                  variant="primary"
                  onClick={addMarketplace}
                  disabled={addingMarketplace() || !newMarketplaceSource().trim()}
                >
                  {addingMarketplace() ? "Adding…" : "Add"}
                </Button>
              </div>
            </div>
          </SettingsList>

          {/* Known marketplaces */}
          <Show when={(marketplaces() ?? []).length > 0}>
            <SettingsList>
              <For each={marketplaces() ?? []}>
                {(m) => (
                  <div class="flex items-center justify-between gap-4 min-h-14 py-3 border-b border-border-weak-base last:border-none px-2">
                    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span class="text-14-medium text-text-strong">{m.name}</span>
                      <span class="text-12-regular text-text-weak truncate">{sourceLabel(m)}</span>
                      <Show when={m.added}>
                        <span class="text-11-regular text-text-weaker">
                          Updated {new Date(m.added as string).toLocaleDateString()}
                        </span>
                      </Show>
                    </div>
                    <div class="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => setView({ type: "marketplace", name: m.name })}
                      >
                        Browse
                      </Button>
                      <Button variant="secondary" size="small" onClick={() => removeMarketplace(m.name)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </SettingsList>
          </Show>

          <Show when={!(marketplaces() ?? []).length}>
            <div class="py-8 text-14-regular text-text-weak text-center">No marketplaces added yet.</div>
          </Show>
        </div>
      </Show>

      {/* Marketplace plugin view */}
      <Show when={activeView() === "marketplace-detail"}>
        <div class="flex flex-col gap-4 max-w-[720px]">
          <div class="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setView("discover")}>
              ← Back
            </Button>
            <span class="text-14-medium text-text-strong">{currentMarketplace()}</span>
          </div>

          <Show
            when={!marketplacePlugins.loading}
            fallback={<div class="py-8 text-14-regular text-text-weak text-center">Loading…</div>}
          >
            <SettingsList>
              <For each={marketplacePlugins() ?? []}>
                {(plugin) => {
                  const key = `${plugin.name}@${currentMarketplace()}`
                  const isInstalled = () => installedIds().has(key)
                  const isLoading = () => loading() === key

                  return (
                    <div class="flex items-center justify-between gap-4 min-h-14 py-3 border-b border-border-weak-base last:border-none px-2">
                      <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="text-14-medium text-text-strong truncate">{plugin.name}</span>
                          <Show when={plugin.author}>
                            <span class="text-11-regular text-text-weaker">· {plugin.author}</span>
                          </Show>
                        </div>
                        <Show when={plugin.description}>
                          <span class="text-12-regular text-text-weak truncate">{plugin.description}</span>
                        </Show>
                      </div>
                      <Button
                        variant={isInstalled() ? "secondary" : "primary"}
                        size="small"
                        disabled={isLoading() || isInstalled()}
                        onClick={() => installPlugin(currentMarketplace() ?? "", plugin.name)}
                      >
                        {isLoading() ? "Installing…" : isInstalled() ? "Installed" : "Install"}
                      </Button>
                    </div>
                  )
                }}
              </For>
            </SettingsList>
          </Show>
        </div>
      </Show>
    </div>
  )
}

export const SettingsPlugins: Component = () => {
  const params = useParams()
  const directory = createMemo(
    () => useGlobalSync().data.project.find((p) => p.id === params.projectID)?.worktree ?? "",
  )

  return (
    <Show
      when={directory()}
      keyed
      fallback={
        <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10 pt-6">
          <div class="flex flex-col pt-6 pb-8 max-w-[720px]">
            <h2 class="text-16-medium text-text-strong">Plugins</h2>
          </div>
          <div class="flex flex-col items-center justify-center py-12 text-center max-w-[720px]">
            <span class="text-14-regular text-text-weak">
              Plugins are managed per workspace. Open a workspace to manage them.
            </span>
          </div>
        </div>
      }
    >
      {(resolved) => (
        <SDKProvider projectID={() => toProjectID(resolved)} directory={() => resolved}>
          <SyncProvider>
            <SettingsPluginsInner projectID={toProjectID(resolved)} />
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
