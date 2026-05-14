import { Box, type Color, Text, useInput } from "@liteai/ink"
import { useEffect, useMemo, useState } from "react"
import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useKeybindings } from "../keybindings/use-keybinding"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"

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

export function DialogPlugin({ onClose: _onClose }: { onClose: () => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()
  const [tab, setTab] = useState<Tab>("discover")
  const [loading, setLoading] = useState(false)

  const [installed, setInstalled] = useState<PluginEntry[]>([])
  const [marketplaces, setMarketplaces] = useState<MarketplaceEntry[]>([])

  const refetchInstalled = async () => {
    const res = await sdk.fetch(`${sdk.url}/plugin`)
    if (!res.ok) return
    const data = await res.json()
    setInstalled(data as PluginEntry[])
  }

  const refetchMarketplaces = async () => {
    const res = await sdk.fetch(`${sdk.url}/plugin/marketplace`)
    if (!res.ok) return
    const data = await res.json()
    setMarketplaces(data as MarketplaceEntry[])
  }

  useEffect(() => {
    void refetchInstalled()
    void refetchMarketplaces()
  }, [sdk.url, sdk.fetch])

  const errors = useMemo<PluginError[]>(() => {
    const all = installed ?? []
    return all
      .filter((p) => !p.enabled && p.marketplace !== "__local__")
      .map((p) => ({
        id: p.id,
        name: p.name,
        marketplace: p.marketplace,
        reason: `Plugin '${p.name}' not found in marketplace '${p.marketplace}'`,
      }))
  }, [installed])

  const tabOptions = useMemo(
    () => [
      { value: "discover" as Tab, title: "Discover" },
      { value: "installed" as Tab, title: "Installed" },
      { value: "marketplaces" as Tab, title: "Marketplaces" },
      {
        value: "errors" as Tab,
        title: errors.length > 0 ? `Errors (${errors.length})` : "Errors",
      },
    ],
    [errors.length],
  )

  const tabs: Tab[] = ["discover", "installed", "marketplaces", "errors"]

  const cycleTab = (dir: 1 | -1) => {
    const idx = tabs.indexOf(tab)
    setTab(tabs[(idx + dir + tabs.length) % tabs.length])
  }

  useInput((_char, _key, evt) => {
    if (evt?.keypress?.name === "escape") {
      dialog.clear()
      return
    }
    if (evt?.keypress?.name === "left") {
      cycleTab(-1)
      return
    }
    if (evt?.keypress?.name === "right") {
      cycleTab(1)
      return
    }
  })

  const header = (
    <Box flexDirection="row" gap={2} paddingBottom={1}>
      {tabOptions.map((opt) => (
        <Text
          key={opt.value}
          color={tab === opt.value ? (theme.primary as Color) : (theme.textMuted as Color)}
          bold={tab === opt.value}
        >
          {opt.title}
        </Text>
      ))}
    </Box>
  )

  return (
    <Box gap={1} paddingBottom={1} flexDirection="column" width="100%" height="100%">
      <Box paddingLeft={4} paddingRight={4}>
        <Box flexDirection="row" justifyContent="space-between" width="100%">
          <Text color={theme.text as Color} bold>
            /plugin
          </Text>
          <Text color={theme.textMuted as Color}>esc</Text>
        </Box>
      </Box>

      <Box paddingLeft={4} paddingRight={4}>
        {header}
      </Box>

      <Box flexGrow={1} flexDirection="column">
        {tab === "discover" && <DiscoverTab sdk={sdk} theme={theme} onInstall={() => void refetchInstalled()} />}

        {tab === "installed" && (
          <InstalledTab
            plugins={installed ?? []}
            loading={loading}
            sdk={sdk}
            theme={theme}
            onToggle={async (id, enabled) => {
              setLoading(true)
              await sdk.fetch(`${sdk.url}/plugin/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, {
                method: "POST",
              })
              await refetchInstalled()
              setLoading(false)
            }}
            onUninstall={async (id) => {
              setLoading(true)
              await sdk.fetch(`${sdk.url}/plugin/${encodeURIComponent(id)}`, { method: "DELETE" })
              await refetchInstalled()
              setLoading(false)
            }}
          />
        )}

        {tab === "marketplaces" && (
          <MarketplacesTab
            marketplaces={marketplaces ?? []}
            sdk={sdk}
            theme={theme}
            onAdded={() => void refetchMarketplaces()}
            onRemoved={() => void refetchMarketplaces()}
            dialog={dialog}
          />
        )}

        {tab === "errors" && <ErrorsTab errors={errors} theme={theme} />}
      </Box>

      <Box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
        <Text color={theme.textMuted as Color}>← → to switch tabs · Enter to select · Esc to close</Text>
      </Box>
    </Box>
  )
}

function DiscoverTab(props: {
  sdk: ReturnType<typeof useSDK>
  theme: ReturnType<typeof useTheme>["theme"]
  onInstall: () => void
}) {
  const [marketplaces, setMarketplaces] = useState<MarketplaceEntry[]>([])
  const [selectedMarketplace, setSelectedMarketplace] = useState<string | null>(null)
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([])
  const [installed, setInstalled] = useState<PluginEntry[]>([])

  useEffect(() => {
    props.sdk
      .fetch(`${props.sdk.url}/plugin/marketplace`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setMarketplaces(data as MarketplaceEntry[]))
      .catch(() => {})

    props.sdk
      .fetch(`${props.sdk.url}/plugin`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setInstalled(data as PluginEntry[]))
      .catch(() => {})
  }, [props.sdk.url, props.sdk.fetch])

  useEffect(() => {
    if (!selectedMarketplace) return
    props.sdk
      .fetch(`${props.sdk.url}/plugin/marketplace/${encodeURIComponent(selectedMarketplace)}/plugins`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setPlugins(data as MarketplacePlugin[]))
      .catch(() => {})
  }, [selectedMarketplace, props.sdk.url, props.sdk.fetch])

  const allPlugins = useMemo(() => {
    const mps = marketplaces ?? []
    const ps = plugins ?? []
    const inst = installed ?? []
    const sel = selectedMarketplace
    if (!sel) return []
    const mp = mps.find((m) => m.id === sel)
    const displayName = mp?.name ?? sel
    return ps.map((p) => ({
      ...p,
      marketplace: sel,
      marketplaceName: displayName,
      isInstalled: inst.some((i) => i.name === p.name && i.marketplace === sel),
    }))
  }, [marketplaces, plugins, installed, selectedMarketplace])

  const options = useMemo(() => {
    const mps = marketplaces ?? []

    if (!selectedMarketplace) {
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
      })) as DialogSelectOption<string>[]
    }

    return allPlugins.map((p) => ({
      value: `${p.marketplace}::${p.name}`,
      title: p.name,
      description: p.description ?? "",
      footer: p.isInstalled ? (
        <Text color={props.theme.success as Color}>✓ installed</Text>
      ) : (
        <Text color={props.theme.textMuted as Color}>○ not installed</Text>
      ),
      category: p.marketplaceName,
    })) as DialogSelectOption<string>[]
  }, [marketplaces, selectedMarketplace, allPlugins, props.theme])

  const [installing, setInstalling] = useState<string | null>(null)

  if ((marketplaces ?? []).length === 0) {
    return (
      <Box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <Text color={props.theme.textMuted as Color}>
          No marketplaces added. Switch to Marketplaces tab to add one.
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {selectedMarketplace && (
        <Box paddingLeft={4} paddingRight={4}>
          <Text color={props.theme.textMuted as Color}>← Back to marketplaces</Text>
        </Box>
      )}
      <DialogSelect
        title={
          selectedMarketplace
            ? `Discover plugins · ${(marketplaces ?? []).find((m) => m.id === selectedMarketplace)?.name ?? selectedMarketplace}`
            : "Discover plugins"
        }
        placeholder="Search..."
        options={options}
        footerContent={<Text color={props.theme.textMuted as Color}>Enter to install · Esc to back</Text>}
        onSelect={async (opt) => {
          if (!selectedMarketplace) {
            setSelectedMarketplace(opt.value as string)
            return
          }
          const [marketplace, name] = (opt.value as string).split("::")
          if (installing) return
          setInstalling(opt.value as string)
          await props.sdk.fetch(
            `${props.sdk.url}/plugin/marketplace/${encodeURIComponent(marketplace)}/install/${encodeURIComponent(name)}`,
            { method: "POST" },
          )
          setInstalling(null)
          props.onInstall()
        }}
        onEscape={() => {
          if (selectedMarketplace) setSelectedMarketplace(null)
        }}
      />
    </Box>
  )
}

function InstalledTab(props: {
  plugins: PluginEntry[]
  loading: boolean
  sdk: ReturnType<typeof useSDK>
  theme: ReturnType<typeof useTheme>["theme"]
  onToggle: (id: string, enabled: boolean) => void
  onUninstall: (id: string) => void
}) {
  const options = useMemo(
    () =>
      props.plugins.map((p) => ({
        value: p.id,
        title: p.name,
        description: p.marketplace === "__local__" ? "local" : p.marketplace,
        footer: p.enabled ? (
          <Text color={props.theme.success as Color}>○ enabled</Text>
        ) : (
          <Text color={props.theme.textMuted as Color}>○ disabled</Text>
        ),
        category: p.marketplace === "__local__" ? "Local" : "User",
      })) as DialogSelectOption<string>[],
    [props.plugins, props.theme],
  )

  const [selectedOption, setSelectedOption] = useState<DialogSelectOption<string> | undefined>()

  useKeybindings(
    {
      "select:toggle": () => {
        if (!selectedOption) return
        const plugin = props.plugins.find((p) => p.id === selectedOption.value)
        if (!plugin) return
        props.onToggle(plugin.id, !plugin.enabled)
      },
      "select:delete": () => {
        if (!selectedOption) return
        props.onUninstall(selectedOption.value as string)
      },
    },
    { context: "Select" },
  )

  if (props.plugins.length === 0) {
    return (
      <Box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <Text color={props.theme.textMuted as Color}>No plugins installed. Discover plugins in the Discover tab.</Text>
      </Box>
    )
  }

  return (
    <DialogSelect
      title="Installed plugins"
      placeholder="Search..."
      options={options}
      footerContent={
        <Text color={props.theme.textMuted as Color}>Space to toggle · ctrl+d to uninstall · Esc to back</Text>
      }
      onMove={setSelectedOption}
      onSelect={() => {}}
    />
  )
}

function MarketplacesTab(props: {
  marketplaces: MarketplaceEntry[]
  sdk: ReturnType<typeof useSDK>
  theme: ReturnType<typeof useTheme>["theme"]
  onAdded: () => void
  onRemoved: () => void
  dialog: ReturnType<typeof useDialog>
}) {
  const options = useMemo(
    () =>
      [
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
      ] as DialogSelectOption<string>[],
    [props.marketplaces],
  )

  const [selectedOption, setSelectedOption] = useState<DialogSelectOption<string> | undefined>()

  useKeybindings(
    {
      "select:delete": () => {
        if (!selectedOption || selectedOption.value === "__add__") return
        const m = props.marketplaces.find((mx) => mx.id === selectedOption.value)
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
      "select:update": async () => {
        if (!selectedOption || selectedOption.value === "__add__") return
        const m = props.marketplaces.find((mx) => mx.id === selectedOption.value)
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
    { context: "Select" },
  )

  return (
    <DialogSelect
      title="Manage marketplaces"
      placeholder="Search..."
      options={options}
      footerContent={
        <Text color={props.theme.textMuted as Color}>
          Enter to select · ctrl+u to update · Del to remove · Esc to go back
        </Text>
      }
      onMove={setSelectedOption}
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
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    await props.sdk.fetch(`${props.sdk.url}/plugin/marketplace/${encodeURIComponent(props.id)}`, { method: "DELETE" })
    props.onDone()
  }

  useInput((_char, _key, evt) => {
    if (evt?.keypress?.name === "return") {
      void confirm()
    }
    if (evt?.keypress?.name === "escape" && !busy) {
      props.onCancel()
    }
  })

  return (
    <Box paddingLeft={2} paddingRight={2} gap={1} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={props.theme.text as Color}>
          Remove Marketplace
        </Text>
        <Text color={props.theme.textMuted as Color}>esc</Text>
      </Box>
      {!busy ? (
        <Text color={props.theme.text as Color}>
          Remove <Text color={props.theme.primary as Color}>{props.name}</Text>?
        </Text>
      ) : (
        <Text color={props.theme.textMuted as Color}>Removing {props.name}…</Text>
      )}
      <Box paddingBottom={1} flexDirection="row" gap={2}>
        {!busy && (
          <>
            <Text color={props.theme.text as Color}>
              enter <Text color={props.theme.textMuted as Color}>confirm</Text>
            </Text>
            <Text color={props.theme.textMuted as Color}>esc cancel</Text>
          </>
        )}
      </Box>
    </Box>
  )
}

function AddMarketplaceDialog(props: {
  sdk: ReturnType<typeof useSDK>
  theme: ReturnType<typeof useTheme>["theme"]
  onDone: () => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)

  const submit = async (value: string) => {
    if (!value.trim() || busy) return
    setBusy(true)
    await props.sdk.fetch(`${props.sdk.url}/plugin/marketplace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: value.trim() }),
    })
    props.onDone()
  }

  if (busy) {
    return (
      <Box paddingLeft={2} paddingRight={2} gap={1} flexDirection="column">
        <Text bold color={props.theme.text as Color}>
          Add Marketplace
        </Text>
        <Text color={props.theme.textMuted as Color}>Downloading marketplace…</Text>
      </Box>
    )
  }

  return (
    <DialogPrompt
      title="Add Marketplace"
      placeholder="owner/repo or https://..."
      description={
        <Box gap={0} flexDirection="column">
          <Text color={props.theme.textMuted as Color}>Enter marketplace source:</Text>
          <Text color={props.theme.textMuted as Color}>Examples:</Text>
          <Text color={props.theme.textMuted as Color}> • owner/repo (GitHub)</Text>
          <Text color={props.theme.textMuted as Color}> • git@github.com:owner/repo.git (SSH)</Text>
          <Text color={props.theme.textMuted as Color}> • https://example.com/marketplace.json</Text>
        </Box>
      }
      onConfirm={(val) => {
        void submit(val)
      }}
      onCancel={props.onCancel}
    />
  )
}

function ErrorsTab(props: { errors: PluginError[]; theme: ReturnType<typeof useTheme>["theme"] }) {
  if (props.errors.length === 0) {
    return (
      <Box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <Text color={props.theme.success as Color}>✓ No plugin errors</Text>
      </Box>
    )
  }

  return (
    <Box paddingLeft={4} paddingRight={4} gap={1} flexDirection="column">
      {props.errors.map((err) => (
        <Box key={err.id} gap={0} flexDirection="column">
          <Text color={props.theme.text as Color} bold>
            {`> ${err.name} @ ${err.marketplace}`}
          </Text>
          <Text color={props.theme.error as Color}>{`  ${err.reason}`}</Text>
          <Text color={props.theme.textMuted as Color}>{"  Plugin may not exist in marketplace"}</Text>
        </Box>
      ))}
    </Box>
  )
}
