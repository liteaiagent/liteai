import { Switch } from "@liteai/ui/switch"
import { useParams } from "@solidjs/router"
import { type Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider } from "@/context/sync"
import { toProjectID } from "@/utils/project-id"
import { SettingsList } from "./settings-list"

interface Agent {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  enabled?: boolean
  model?: {
    modelID: string
    providerID: string
  }
}

const modeLabels = {
  subagent: "settings.agents.mode.subagent",
  primary: "settings.agents.mode.primary",
  all: "settings.agents.mode.all",
} as const

const modeColors = {
  subagent: "color-blue-500",
  primary: "color-green-500",
  all: "text-text-weak",
} as const

const SettingsAgentsInner: Component = () => {
  const language = useLanguage()
  const sdk = useSDK()

  const [agents, { refetch: refetchAgents }] = createResource(async () => {
    try {
      const { data } = await sdk.client.project.agent.list({ projectID: sdk.projectID })
      return (data ?? []) as Agent[]
    } catch {
      return [] as Agent[]
    }
  })

  const visible = createMemo(() => (agents() ?? []).filter((a) => !a.hidden))
  const count = createMemo(() => visible().length)

  const [loading, setLoading] = createSignal<string | null>(null)

  const toggle = async (name: string, currentlyEnabled: boolean) => {
    if (loading()) return
    setLoading(name)
    try {
      const res = await sdk.client.project.config.get({ projectID: sdk.projectID })
      const currentConfig = res.data ?? {}
      const agentConfig = { ...(currentConfig.agent ?? {}) }

      if (currentlyEnabled) {
        agentConfig[name] = { ...(agentConfig[name] ?? {}), disable: true }
      } else {
        agentConfig[name] = { ...(agentConfig[name] ?? {}), disable: false }
      }

      await sdk.client.project.config.update({
        projectID: sdk.projectID,
        config: {
          ...currentConfig,
          agent: agentConfig,
        },
      })
      await refetchAgents()
    } finally {
      setLoading(null)
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.agents.title")}</h2>
          <p class="text-13-regular text-text-weak">{language.t("settings.agents.loaded", { count: count() })}</p>
        </div>
      </div>

      <div class="flex flex-col gap-4 max-w-[720px]">
        <Show
          when={!agents.loading && count() > 0}
          fallback={
            <SettingsList>
              <div class="py-8 text-14-regular text-text-weak text-center">
                {agents.loading
                  ? `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`
                  : language.t("settings.agents.empty")}
              </div>
            </SettingsList>
          }
        >
          <SettingsList>
            <For each={visible()}>
              {(agent) => {
                const color = () => modeColors[agent.mode] ?? "text-text-weak"
                const label = () => {
                  const key = modeLabels[agent.mode]
                  if (!key) return
                  return language.t(key)
                }

                return (
                  <div class="flex items-center justify-between gap-4 min-h-14 py-3 border-b border-border-weak-base last:border-none px-2 rounded -mx-2 w-full text-left">
                    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div class="flex items-center gap-2.5">
                        <span class="text-14-medium text-text-strong truncate">{agent.name}</span>
                        <span class={`text-11-regular text-${color()}`}>●</span>
                        <Show when={label()}>
                          <span class="text-11-regular text-text-weaker">{label()}</span>
                        </Show>
                        <Show when={agent.native}>
                          <span class="text-11-regular text-text-weaker">
                            {language.t("settings.agents.tag.native")}
                          </span>
                        </Show>
                      </div>
                      <Show when={agent.description}>
                        <span class="text-12-regular text-text-weak">{agent.description}</span>
                      </Show>
                      <Show when={agent.model}>
                        <span class="text-11-regular text-text-weaker">
                          {agent.model?.providerID}/{agent.model?.modelID}
                        </span>
                      </Show>
                    </div>
                    <Show when={agent.name !== "build"}>
                      <div class="flex flex-col items-end gap-2 shrink-0">
                        <Switch
                          checked={agent.enabled !== false}
                          disabled={loading() === agent.name}
                          onChange={() => toggle(agent.name, agent.enabled !== false)}
                        />
                      </div>
                    </Show>
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

export const SettingsAgents: Component = () => {
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
            <h2 class="text-16-medium text-text-strong">{language.t("settings.agents.title")}</h2>
          </div>
          <div class="flex flex-col items-center justify-center py-12 text-center max-w-[720px]">
            <span class="text-14-regular text-text-weak">{language.t("settings.agents.noWorkspace")}</span>
          </div>
        </div>
      }
    >
      {(resolved) => (
        <SDKProvider projectID={() => toProjectID(resolved)} directory={() => resolved}>
          <SyncProvider>
            <SettingsAgentsInner />
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
