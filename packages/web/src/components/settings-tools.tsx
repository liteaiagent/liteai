import { Switch } from "@liteai/ui/switch"
import { useParams } from "@solidjs/router"
import { type Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider } from "@/context/sync"
import { useScopedConfig } from "@/hooks/use-scoped-config"
import { toProjectID } from "@/utils/project-id"
import { SettingsList } from "./settings-list"
import { SettingsScopeSwitcher } from "./settings-scope-switcher"

const SettingsToolsInner: Component<{ projectID: string }> = (props) => {
  const language = useLanguage()
  const sdk = useSDK()
  const { scope, setScope, getConfig, updateConfig } = useScopedConfig()
  const sync = useGlobalSync()

  const [tools, { refetch: refetchTools }] = createResource(async () => {
    try {
      const res = await sdk.client.project.tool.ids({ projectID: props.projectID })
      const data = res.data ?? []
      return data.sort((a: string | { id: string }, b: string | { id: string }) => {
        const idA = typeof a === "string" ? a : a.id
        const idB = typeof b === "string" ? b : b.id
        return idA.localeCompare(idB)
      })
    } catch {
      return []
    }
  })

  const [loading, setLoading] = createSignal<string | null>(null)

  const toggle = async (id: string, currentlyEnabled: boolean) => {
    if (loading()) return
    setLoading(id)
    try {
      const currentConfig = await getConfig(props.projectID)
      const disabledTools = { ...(currentConfig.disabledTools ?? {}) }

      if (currentlyEnabled) {
        disabledTools[id] = true
      } else {
        // When in project scope, explicitly set false to override user-level disable
        if (scope() === "project") {
          disabledTools[id] = false
        } else {
          disabledTools[id] = null as unknown as boolean
        }
      }

      await updateConfig({ disabledTools }, props.projectID)
      await refetchTools()
    } finally {
      setLoading(null)
    }
  }

  return (
    <div
      class={`flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10 transition-opacity duration-300 ${loading() !== null ? "opacity-50 pointer-events-none" : ""}`}
    >
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-4 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tools.title") ?? "Tools"}</h2>
          <p class="text-13-regular text-text-weak">
            {language.t("settings.tools.description") ?? "Available tools for use"}
          </p>
        </div>
        <div class="pb-4">
          <SettingsScopeSwitcher scope={scope} setScope={setScope} hasWorkspace={() => true} />
        </div>
      </div>

      <div class="flex flex-col gap-4 max-w-[720px]">
        <Show
          when={(tools() ?? []).length > 0}
          fallback={
            <SettingsList>
              <div class="py-8 text-14-regular text-text-weak text-center">
                {language.t("dialog.tools.empty") ?? "No tools available."}
              </div>
            </SettingsList>
          }
        >
          <SettingsList>
            <For each={tools()}>
              {(toolItem: string | { id: string; native?: boolean; enabled?: boolean }) => {
                const tool = typeof toolItem === "string" ? { id: toolItem, native: false, enabled: true } : toolItem
                return (
                  <div class="flex items-center justify-between gap-4 min-h-14 py-3 border-b border-border-weak-base last:border-none px-2 rounded -mx-2 w-full text-left">
                    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="text-14-medium text-text-strong truncate">{tool.id}</span>
                        <Show when={tool.native}>
                          <span class="text-11-regular text-text-weaker">built-in</span>
                        </Show>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <Switch
                        checked={
                          scope() === "user"
                            ? sync.data.config?.disabledTools?.[tool.id] !== true
                            : tool.enabled !== false
                        }
                        disabled={loading() === tool.id}
                        onChange={() => toggle(tool.id, tool.enabled !== false)}
                      />
                    </div>
                  </div>
                )
              }}
            </For>
          </SettingsList>
        </Show>
      </div>
    </div>
  )
}

export const SettingsTools: Component = () => {
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
            <h2 class="text-16-medium text-text-strong">{language.t("settings.tools.title") ?? "Tools"}</h2>
          </div>
          <div class="flex flex-col items-center justify-center py-12 text-center max-w-[720px]">
            <span class="text-14-regular text-text-weak">Open a workspace to manage tool settings.</span>
          </div>
        </div>
      }
    >
      {(resolved) => (
        <SDKProvider projectID={() => toProjectID(resolved)} directory={() => resolved}>
          <SyncProvider>
            <SettingsToolsInner projectID={toProjectID(resolved)} />
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
