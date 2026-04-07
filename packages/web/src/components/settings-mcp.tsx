import { Button } from "@liteai/ui/button"
import { Switch } from "@liteai/ui/switch"
import { useParams } from "@solidjs/router"
import { type Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { useScopedConfig } from "@/hooks/use-scoped-config"
import { toProjectID } from "@/utils/project-id"
import { SettingsList } from "./settings-list"
import { SettingsScopeSwitcher } from "./settings-scope-switcher"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
  needs_client_registration: "mcp.status.needs_auth",
} as const

const statusColors = {
  connected: "color-green-500",
  failed: "color-red-500",
  needs_auth: "color-yellow-500",
  disabled: "text-weaker",
  needs_client_registration: "color-yellow-500",
} as const

export const SettingsMcpInner: Component<{ projectID: string }> = (props) => {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const [loading, setLoading] = createSignal<string | null>(null)
  const { scope, setScope, getConfig, updateConfig } = useScopedConfig()

  const items = createMemo(() =>
    Object.entries(sync.data.mcp ?? {})
      .map(([name, status]) => ({ name, status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const [tools, { refetch }] = createResource(
    () => items().filter((i) => i.status.status === "connected").length,
    async () => {
      try {
        const res = await sdk.client.project.mcp.tools({ projectID: sdk.projectID })
        if (!res.data) return {} as Record<string, string[]>
        return res.data as Record<string, string[]>
      } catch (err) {
        console.error("Failed to parse tools:", err)
        return {} as Record<string, string[]>
      }
    },
  )

  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)
    try {
      const status = sync.data.mcp[name]
      if (status?.status === "connected") {
        // Disconnect runtime + persist disabled
        await sdk.client.project.mcp.disconnect({ name, projectID: props.projectID })
        const currentConfig = await getConfig(props.projectID)
        const mcpServers = { ...(currentConfig.mcpServers ?? {}) }
        if (mcpServers[name]) {
          mcpServers[name] = { ...mcpServers[name], disabled: true }
          await updateConfig({ mcpServers }, props.projectID)
        }
      } else {
        // Connect runtime + remove disabled flag
        const currentConfig = await getConfig(props.projectID)
        const mcpServers = { ...(currentConfig.mcpServers ?? {}) }
        if (mcpServers[name]?.disabled) {
          mcpServers[name] = { ...mcpServers[name], disabled: false }
          await updateConfig({ mcpServers }, props.projectID)
        }
        await sdk.client.project.mcp.connect({ name, projectID: props.projectID })
      }
      const result = await sdk.client.project.mcp.status({ projectID: props.projectID })
      if (result.data) sync.set("mcp", result.data)
      refetch()
    } finally {
      setLoading(null)
    }
  }

  const enabled = createMemo(() => items().filter((i) => i.status.status === "connected").length)
  const [selected, setSelected] = createSignal<string | null>(null)

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <Show
        when={selected()}
        fallback={
          <>
            <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
              <div class="flex flex-col gap-1 pt-6 pb-4 max-w-[720px]">
                <h2 class="text-16-medium text-text-strong">{language.t("settings.mcp.title")}</h2>
                <p class="text-13-regular text-text-weak">
                  {language.t("settings.mcp.connected", { enabled: enabled(), total: items().length })}
                </p>
              </div>
              <div class="pb-4">
                <SettingsScopeSwitcher scope={scope} setScope={setScope} hasWorkspace={() => true} />
              </div>
            </div>

            <div class="flex flex-col gap-4 max-w-[720px]">
              <Show
                when={items().length > 0}
                fallback={
                  <SettingsList>
                    <div class="py-8 text-14-regular text-text-weak text-center">{language.t("dialog.mcp.empty")}</div>
                  </SettingsList>
                }
              >
                <SettingsList>
                  <For each={items()}>
                    {(item) => {
                      const status = () => item.status.status
                      const label = () => {
                        const key = statusLabels[status() as keyof typeof statusLabels]
                        if (!key) return
                        return language.t(key)
                      }
                      const color = () => statusColors[status() as keyof typeof statusColors] ?? "text-weaker"
                      const error = () =>
                        item.status.status === "failed" ? (item.status as { error: string }).error : undefined
                      const active = () => status() === "connected"
                      const serverTools = () => tools()?.[item.name] ?? []

                      return (
                        <button
                          type="button"
                          class="flex items-center justify-between gap-4 min-h-14 py-3 border-b border-border-weak-base last:border-none cursor-pointer hover:bg-surface-base px-2 rounded -mx-2 w-full text-left"
                          onClick={() => setSelected(item.name)}
                        >
                          <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                            <div class="flex items-center gap-2.5">
                              <span class="text-14-medium text-text-strong truncate">{item.name}</span>
                              <span class={`text-11-regular text-${color()}`}>●</span>
                              <Show when={label()}>
                                <span class="text-11-regular text-text-weaker">{label()}</span>
                              </Show>
                              <Show when={active() && serverTools().length > 0}>
                                <span class="text-11-regular text-text-weaker">
                                  {language.t("settings.mcp.tools.count", { count: serverTools().length })}
                                </span>
                              </Show>
                              <Show when={loading() === item.name}>
                                <span class="text-11-regular text-text-weak">
                                  {language.t("common.loading")}
                                  {language.t("common.loading.ellipsis")}
                                </span>
                              </Show>
                            </div>
                            <Show when={error()}>
                              <span class="text-11-regular text-text-weaker truncate">{error()}</span>
                            </Show>
                          </div>
                          <Switch
                            onClick={(e: Event) => e.stopPropagation()}
                            onKeyDown={(e: KeyboardEvent) => e.stopPropagation()}
                            checked={active()}
                            disabled={loading() === item.name}
                            onChange={() => toggle(item.name)}
                          />
                        </button>
                      )
                    }}
                  </For>
                </SettingsList>
              </Show>
            </div>
          </>
        }
      >
        {(selectedName) => {
          const item = createMemo(() => items().find((i) => i.name === selectedName()))
          if (!item()) return null

          type StatusExtra = { command?: string; args?: string[]; url?: string; error?: string }
          const status = () => item()?.status.status
          const label = () => {
            const key = statusLabels[status() as keyof typeof statusLabels]
            if (!key) return
            return language.t(key)
          }
          const color = () => statusColors[status() as keyof typeof statusColors] ?? "text-weaker"
          const error = () => (item()?.status.status === "failed" ? (item()?.status as StatusExtra).error : undefined)
          const active = () => status() === "connected"
          const serverTools = () => tools()?.[item()?.name ?? ""] ?? []
          const command = () => (item()?.status as StatusExtra).command
          const args = () => (item()?.status as StatusExtra).args ?? []
          const url = () => (item()?.status as StatusExtra).url

          return (
            <div class="flex flex-col gap-6 pt-6 max-w-[720px]">
              <div class="flex items-center gap-2">
                <Button variant="secondary" onClick={() => setSelected(null)}>
                  {language.t("ui.common.back") ?? "Back"}
                </Button>
                <div class="flex-1" />
                <Switch
                  checked={active()}
                  disabled={loading() === item()?.name}
                  onChange={() => toggle(item()?.name ?? "")}
                />
              </div>

              <div class="flex flex-col gap-2">
                <div class="flex items-center gap-2.5">
                  <span class="text-18-semibold text-text-strong">{item()?.name}</span>
                  <span class={`text-12-regular text-${color()}`}>●</span>
                  <Show when={label()}>
                    <span class="text-12-regular text-text-weaker">{label()}</span>
                  </Show>
                </div>

                <SettingsList>
                  <Show when={error()}>
                    <div class="px-3 py-2 bg-surface-base text-red-500 text-13-regular border-b border-border-weaker-base">
                      {error()}
                    </div>
                  </Show>
                  <Show when={command()}>
                    <div class="px-3 py-2 bg-surface-base text-text-weak text-13-regular border-b border-border-weaker-base truncate">
                      <span class="text-text-strong">Local command: </span>
                      {command()} {args().join(" ")}
                    </div>
                  </Show>
                  <Show when={url()}>
                    <div class="px-3 py-2 bg-surface-base text-text-weak text-13-regular border-b border-border-weaker-base truncate">
                      <span class="text-text-strong">Remote URL: </span>
                      {url()}
                    </div>
                  </Show>
                  <div class="px-3 py-2 bg-surface-base text-text-weak text-13-regular flex justify-between items-center">
                    <span>Tools</span>
                    <span class="text-12-medium bg-surface-stronger px-2 py-0.5 rounded">{serverTools().length}</span>
                  </div>
                </SettingsList>

                <Show when={active() && serverTools().length > 0}>
                  <div class="flex flex-col gap-1.5 mt-4">
                    <span class="text-14-medium text-text-strong">Available Tools</span>
                    <div class="flex flex-col border border-border-weak-base rounded">
                      <For each={serverTools()}>
                        {(tool) => (
                          <div class="px-3 py-2 border-b border-border-weak-base last:border-none text-13-regular text-text-strong">
                            {tool}
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          )
        }}
      </Show>
    </div>
  )
}

export const SettingsMcp: Component = () => {
  const language = useLanguage()
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
            <h2 class="text-16-medium text-text-strong">{language.t("settings.mcp.title")}</h2>
          </div>
          <div class="flex flex-col items-center justify-center py-12 text-center max-w-[720px]">
            <span class="text-14-regular text-text-weak">
              MCP servers are configured per workspace. Open a workspace to manage them.
            </span>
          </div>
        </div>
      }
    >
      {(resolved) => (
        <SDKProvider projectID={() => toProjectID(resolved)} directory={() => resolved}>
          <SyncProvider>
            <SettingsMcpInner projectID={toProjectID(resolved)} />
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
