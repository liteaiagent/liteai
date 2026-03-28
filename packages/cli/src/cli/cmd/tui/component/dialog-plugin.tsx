import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { Keybind } from "liteai/util/keybind"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useTheme } from "../context/theme"

type Tab = "discover" | "installed" | "marketplaces" | "errors"

type PluginEntry = {
  id: string
  name: string
  marketplace: string
  version?: string
  enabled: boolean
  scope: "user" | "project" | "local"
}

type MarketplaceEntry = {
  id: string
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
}

type PluginError = {
  id: string
  name: string
  marketplace: string
  reason: string
}

export function DialogPlugin() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()
  const [tab, setTab] = createSignal<Tab>("discover")
  const [loading, setLoading] = createSignal(false)

  // Installed plugins
  const [installed, { refetch: refetchInstalled }] = createResource(async () => {
    const res = await sdk.fetch(`${sdk.url}/plugin`)
    if (!res.ok) return [] as PluginEntry[]
    return res.json() as Promise<PluginEntry[]>
  })

  // Marketplaces
  const [marketplaces, { refetch: refetchMarketplaces }] = createResource(async () => {
    const res = await sdk.fetch(`${sdk.url}/plugin/marketplace`)
    if (!res.ok) return [] as MarketplaceEntry[]
    return res.json() as Promise<MarketplaceEntry[]>
  })

  // Errors: installed but failed
  const errors = createMemo<PluginError[]>(() => {
    const all = installed() ?? []
    return all
      .filter((p) => !p.enabled && p.marketplace !== "__local__")
      .map((p) => ({
        id: p.id,
        name: p.name,
        marketplace: p.marketplace,
        reason: `Plugin '${p.name}' not found in marketplace '${p.marketplace}'`,
      }))
  })

  const tabOptions = createMemo(() => [
    { value: "discover" as Tab, title: "Discover" },
    { value: "installed" as Tab, title: "Installed" },
    { value: "marketplaces" as Tab, title: "Marketplaces" },
    {
      value: "errors" as Tab,
      title: errors().length > 0 ? `Errors (${errors().length})` : "Errors",
    },
  ])

  const tabs: Tab[] = ["discover", "installed", "marketplaces", "errors"]

  const cycleTab = (dir: 1 | -1) => {
    const idx = tabs.indexOf(tab())
    setTab(tabs[(idx + dir + tabs.length) % tabs.length])
  }

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      dialog.clear()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "left") {
      cycleTab(-1)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "right") {
      cycleTab(1)
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  // Tab header bar
  const header = () => (
    <box flexDirection="row" gap={2} paddingBottom={1}>
      {tabOptions().map((opt) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: TUI element
        <text
          fg={tab() === opt.value ? theme.primary : theme.textMuted}
          attributes={tab() === opt.value ? TextAttributes.BOLD : undefined}
          onMouseUp={() => setTab(opt.value)}
        >
          {opt.title}
        </text>
      ))}
    </box>
  )

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            /plugin
          </text>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: TUI element */}
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4}>
        {header()}
      </box>

      <Show when={tab() === "discover"}>
        <DiscoverTab sdk={sdk} theme={theme} onInstall={refetchInstalled} />
      </Show>

      <Show when={tab() === "installed"}>
        <InstalledTab
          plugins={installed() ?? []}
          loading={loading()}
          sdk={sdk}
          theme={theme}
          onToggle={async (id, enabled) => {
            setLoading(true)
            await sdk.fetch(`${sdk.url}/plugin/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, {
              method: "POST",
            })
            refetchInstalled()
            setLoading(false)
          }}
          onUninstall={async (id) => {
            setLoading(true)
            await sdk.fetch(`${sdk.url}/plugin/${encodeURIComponent(id)}`, { method: "DELETE" })
            refetchInstalled()
            setLoading(false)
          }}
        />
      </Show>

      <Show when={tab() === "marketplaces"}>
        <MarketplacesTab
          marketplaces={marketplaces() ?? []}
          sdk={sdk}
          theme={theme}
          onAdded={refetchMarketplaces}
          onRemoved={refetchMarketplaces}
          dialog={dialog}
        />
      </Show>

      <Show when={tab() === "errors"}>
        <ErrorsTab errors={errors()} theme={theme} />
      </Show>

      <box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
        <text fg={theme.textMuted}>← → to switch tabs · Enter to select · Esc to close</text>
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Discover tab
// ---------------------------------------------------------------------------

function DiscoverTab(props: {
  sdk: ReturnType<typeof useSDK>
  theme: ReturnType<typeof useTheme>["theme"]
  onInstall: () => void
}) {
  const [marketplaces] = createResource(async () => {
    const res = await props.sdk.fetch(`${props.sdk.url}/plugin/marketplace`)
    if (!res.ok) return [] as MarketplaceEntry[]
    return res.json() as Promise<MarketplaceEntry[]>
  })

  const [selectedMarketplace, setSelectedMarketplace] = createSignal<string | null>(null)
  const [plugins] = createResource(selectedMarketplace, async (id) => {
    const res = await props.sdk.fetch(`${props.sdk.url}/plugin/marketplace/${encodeURIComponent(id)}/plugins`)
    if (!res.ok) return [] as MarketplacePlugin[]
    return res.json() as Promise<MarketplacePlugin[]>
  })

  const [installed] = createResource(async () => {
    const res = await props.sdk.fetch(`${props.sdk.url}/plugin`)
    if (!res.ok) return [] as PluginEntry[]
    return res.json() as Promise<PluginEntry[]>
  })

  // Aggregate all plugins from all marketplaces
  const allPlugins = createMemo<
    Array<MarketplacePlugin & { marketplace: string; marketplaceName: string; isInstalled: boolean }>
  >(() => {
    const mps = marketplaces() ?? []
    const ps = plugins() ?? []
    const inst = installed() ?? []
    const sel = selectedMarketplace()
    if (!sel) return []
    const mp = mps.find((m) => m.id === sel)
    const displayName = mp?.name ?? sel
    return ps.map((p) => ({
      ...p,
      marketplace: sel,
      marketplaceName: displayName,
      isInstalled: inst.some((i) => i.name === p.name && i.marketplace === sel),
    }))
  })

  const options = createMemo(() => {
    const mps = marketplaces() ?? []

    if (!selectedMarketplace()) {
      // Show marketplace selection
      return mps.map((m) => ({
        value: m.id,
        title: m.name,
        description:
          typeof m.source === "string"
            ? m.source
            : "source" in m.source
              ? ((m.source as { repo?: string; url?: string }).repo ?? (m.source as { url?: string }).url ?? "")
              : "",
        category: "Marketplaces",
      }))
    }

    return allPlugins().map((p) => ({
      value: `${p.marketplace}::${p.name}`,
      title: p.name,
      description: p.description ?? "",
      footer: p.isInstalled ? (
        <text fg={props.theme.success}>✓ installed</text>
      ) : (
        <text fg={props.theme.textMuted}>○ not installed</text>
      ),
      category: p.marketplaceName,
    }))
  })

  const [installing, setInstalling] = createSignal<string | null>(null)

  return (
    <Show
      when={(marketplaces() ?? []).length > 0}
      fallback={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={props.theme.textMuted}>No marketplaces added. Switch to Marketplaces tab to add one.</text>
        </box>
      }
    >
      <Show when={selectedMarketplace()}>
        <box paddingLeft={4} paddingRight={4}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: TUI element */}
          <text fg={props.theme.textMuted} onMouseUp={() => setSelectedMarketplace(null)}>
            ← Back to marketplaces
          </text>
        </box>
      </Show>
      <DialogSelect
        title={
          selectedMarketplace()
            ? `Discover plugins · ${(marketplaces() ?? []).find((m) => m.id === selectedMarketplace())?.name ?? selectedMarketplace()}`
            : "Discover plugins"
        }
        placeholder="Search..."
        options={options()}
        footerContent={<text fg={props.theme.textMuted}>Enter to install · Esc to back</text>}
        onSelect={async (opt) => {
          if (!selectedMarketplace()) {
            setSelectedMarketplace(opt.value as string)
            return
          }
          const [marketplace, name] = (opt.value as string).split("::")
          if (installing()) return
          setInstalling(opt.value as string)
          await props.sdk.fetch(
            `${props.sdk.url}/plugin/marketplace/${encodeURIComponent(marketplace)}/install/${encodeURIComponent(name)}`,
            { method: "POST" },
          )
          setInstalling(null)
          props.onInstall()
        }}
      />
    </Show>
  )
}

// ---------------------------------------------------------------------------
// Installed tab
// ---------------------------------------------------------------------------

function InstalledTab(props: {
  plugins: PluginEntry[]
  loading: boolean
  sdk: ReturnType<typeof useSDK>
  theme: ReturnType<typeof useTheme>["theme"]
  onToggle: (id: string, enabled: boolean) => void
  onUninstall: (id: string) => void
}) {
  const options = createMemo(() =>
    props.plugins.map((p) => ({
      value: p.id,
      title: p.name,
      description: p.marketplace === "__local__" ? "local" : p.marketplace,
      footer: p.enabled ? (
        <text fg={props.theme.success}>○ enabled</text>
      ) : (
        <text fg={props.theme.textMuted}>○ disabled</text>
      ),
      category: p.marketplace === "__local__" ? "Local" : "User",
    })),
  )

  return (
    <Show
      when={props.plugins.length > 0}
      fallback={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={props.theme.textMuted}>No plugins installed. Discover plugins in the Discover tab.</text>
        </box>
      }
    >
      <DialogSelect
        title="Installed plugins"
        placeholder="Search..."
        options={options()}
        footerContent={<text fg={props.theme.textMuted}>Space to toggle · d to uninstall · Esc to back</text>}
        keybind={[
          {
            title: "toggle",
            keybind: Keybind.parse("space")[0],
            onTrigger: (opt) => {
              const plugin = props.plugins.find((p) => p.id === opt.value)
              if (!plugin) return
              props.onToggle(plugin.id, !plugin.enabled)
            },
          },
          {
            title: "uninstall",
            keybind: Keybind.parse("d")[0],
            onTrigger: (opt) => {
              props.onUninstall(opt.value as string)
            },
          },
        ]}
        onSelect={() => {}}
      />
    </Show>
  )
}

// ---------------------------------------------------------------------------
// Marketplaces tab
// ---------------------------------------------------------------------------

function MarketplacesTab(props: {
  marketplaces: MarketplaceEntry[]
  sdk: ReturnType<typeof useSDK>
  theme: ReturnType<typeof useTheme>["theme"]
  onAdded: () => void
  onRemoved: () => void
  dialog: ReturnType<typeof useDialog>
}) {
  const options = createMemo(() => [
    {
      value: "__add__",
      title: "+ Add Marketplace",
      category: "",
    },
    ...props.marketplaces.map((m) => {
      const sourceTxt =
        typeof m.source === "string"
          ? m.source
          : "repo" in m.source
            ? (m.source as { repo: string }).repo
            : (m.source as { url: string }).url
      return {
        value: m.id,
        title: m.name,
        description: sourceTxt,
        category: "Installed",
      }
    }),
  ])

  return (
    <DialogSelect
      title="Manage marketplaces"
      placeholder="Search..."
      options={options()}
      footerContent={
        <text fg={props.theme.textMuted}>Enter to select · u to update · Del to remove · Esc to go back</text>
      }
      keybind={[
        {
          title: "remove",
          keybind: Keybind.parse("delete")[0],
          onTrigger: async (opt) => {
            if (opt.value === "__add__") return
            const m = props.marketplaces.find((mx) => mx.id === opt.value)
            if (!m) return
            props.dialog.push(() => (
              <RemoveMarketplaceDialog
                name={m.name}
                id={m.id}
                sdk={props.sdk}
                theme={props.theme}
                onDone={() => {
                  props.dialog.pop()
                  props.onRemoved()
                }}
                onCancel={() => props.dialog.pop()}
              />
            ))
          },
        },
        {
          title: "update",
          keybind: Keybind.parse("u")[0],
          onTrigger: async (opt) => {
            if (opt.value === "__add__") return
            const m = props.marketplaces.find((mx) => mx.id === opt.value)
            if (!m) return
            const srcStr =
              typeof m.source === "string"
                ? m.source
                : "repo" in m.source
                  ? (m.source as { repo: string }).repo
                  : (m.source as { url: string }).url
            await props.sdk.fetch(`${props.sdk.url}/plugin/marketplace`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source: srcStr }),
            })
            props.onAdded()
          },
        },
      ]}
      onSelect={(opt) => {
        if (opt.value === "__add__") {
          props.dialog.push(() => (
            <AddMarketplaceDialog
              sdk={props.sdk}
              theme={props.theme}
              onDone={() => {
                props.dialog.pop()
                props.onAdded()
              }}
              onCancel={() => props.dialog.pop()}
            />
          ))
        }
      }}
    />
  )
}

function RemoveMarketplaceDialog(props: {
  name: string
  id: string
  sdk: ReturnType<typeof useSDK>
  theme: ReturnType<typeof useTheme>["theme"]
  onDone: () => void
  onCancel: () => void
}) {
  const [busy, setBusy] = createSignal(false)

  const confirm = async () => {
    if (busy()) return
    setBusy(true)
    await props.sdk.fetch(`${props.sdk.url}/plugin/marketplace/${encodeURIComponent(props.id)}`, { method: "DELETE" })
    props.onDone()
  }

  useKeyboard((evt) => {
    if (evt.name === "return") {
      confirm()
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "escape" && !busy()) {
      props.onCancel()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={props.theme.text}>
          Remove Marketplace
        </text>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: TUI element */}
        <text fg={props.theme.textMuted} onMouseUp={props.onCancel}>
          esc
        </text>
      </box>
      <Show when={!busy()} fallback={<text fg={props.theme.textMuted}>Removing {props.name}…</text>}>
        <text fg={props.theme.text}>
          Remove <span style={{ fg: props.theme.primary }}>{props.name}</span>?
        </text>
      </Show>
      <box paddingBottom={1} flexDirection="row" gap={2}>
        <Show when={!busy()}>
          <text fg={props.theme.text}>
            enter <span style={{ fg: props.theme.textMuted }}>confirm</span>
          </text>
          <text fg={props.theme.textMuted}>esc cancel</text>
        </Show>
      </box>
    </box>
  )
}

function AddMarketplaceDialog(props: {
  sdk: ReturnType<typeof useSDK>
  theme: ReturnType<typeof useTheme>["theme"]
  onDone: () => void
  onCancel: () => void
}) {
  const [busy, setBusy] = createSignal(false)

  const submit = async (value: string) => {
    if (!value.trim() || busy()) return
    setBusy(true)
    await props.sdk.fetch(`${props.sdk.url}/plugin/marketplace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: value.trim() }),
    })
    props.onDone()
  }

  return (
    <Show
      when={!busy()}
      fallback={
        <box paddingLeft={2} paddingRight={2} gap={1}>
          <text attributes={TextAttributes.BOLD} fg={props.theme.text}>
            Add Marketplace
          </text>
          <text fg={props.theme.textMuted}>Downloading marketplace…</text>
        </box>
      }
    >
      <DialogPrompt
        title="Add Marketplace"
        placeholder="owner/repo or https://..."
        description={() => (
          <box gap={0} flexDirection="column">
            <text fg={props.theme.textMuted}>Enter marketplace source:</text>
            <text fg={props.theme.textMuted}>Examples:</text>
            <text fg={props.theme.textMuted}> • owner/repo (GitHub)</text>
            <text fg={props.theme.textMuted}> • git@github.com:owner/repo.git (SSH)</text>
            <text fg={props.theme.textMuted}> • https://example.com/marketplace.json</text>
          </box>
        )}
        onConfirm={submit}
        onCancel={props.onCancel}
      />
    </Show>
  )
}

// ---------------------------------------------------------------------------
// Errors tab
// ---------------------------------------------------------------------------

function ErrorsTab(props: { errors: PluginError[]; theme: ReturnType<typeof useTheme>["theme"] }) {
  return (
    <Show
      when={props.errors.length > 0}
      fallback={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={props.theme.success}>✓ No plugin errors</text>
        </box>
      }
    >
      <box paddingLeft={4} paddingRight={4} gap={1} flexDirection="column">
        <For each={props.errors}>
          {(err) => (
            <box gap={0} flexDirection="column">
              <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
                {`> ${err.name} @ ${err.marketplace}`}
              </text>
              <text fg={props.theme.error}>{`  ${err.reason}`}</text>
              <text fg={props.theme.textMuted}>{"  Plugin may not exist in marketplace"}</text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}
