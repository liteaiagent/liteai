import { useParams } from "@solidjs/router"
import { type Component, createMemo, createResource, For, Show } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider } from "@/context/sync"
import { toProjectID } from "@/utils/project-id"
import { SettingsList } from "./settings-list"

interface Skill {
  name: string
  description: string
  location: string
}

const SettingsSkillsInner: Component = () => {
  const language = useLanguage()
  const sdk = useSDK()

  const [skills] = createResource(async () => {
    try {
      const { data } = await sdk.client.project.skill.list({ projectID: sdk.projectID })
      return (data ?? []) as Skill[]
    } catch {
      return [] as Skill[]
    }
  })

  const count = createMemo(() => skills()?.length ?? 0)

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.skills.title")}</h2>
          <p class="text-13-regular text-text-weak">{language.t("settings.skills.loaded", { count: count() })}</p>
        </div>
      </div>

      <div class="flex flex-col gap-4 max-w-[720px]">
        <Show
          when={!skills.loading && count() > 0}
          fallback={
            <SettingsList>
              <div class="py-8 text-14-regular text-text-weak text-center">
                {skills.loading
                  ? `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`
                  : language.t("settings.skills.empty")}
              </div>
            </SettingsList>
          }
        >
          <SettingsList>
            <For each={skills()}>
              {(skill) => (
                <div class="flex flex-col border-b border-border-weak-base last:border-none">
                  <div class="flex items-start justify-between gap-4 min-h-14 py-3">
                    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span class="text-14-medium text-text-strong truncate">{skill.name}</span>
                      <span class="text-12-regular text-text-weak">{skill.description}</span>
                      <span class="text-11-regular text-text-weaker truncate">{skill.location}</span>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </SettingsList>
        </Show>
      </div>
    </div>
  )
}

export const SettingsSkills: Component = () => {
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
            <h2 class="text-16-medium text-text-strong">{language.t("settings.skills.title")}</h2>
          </div>
          <div class="flex flex-col items-center justify-center py-12 text-center max-w-[720px]">
            <span class="text-14-regular text-text-weak">{language.t("settings.skills.noWorkspace")}</span>
          </div>
        </div>
      }
    >
      {(resolved) => (
        <SDKProvider projectID={() => toProjectID(resolved)} directory={() => resolved}>
          <SyncProvider>
            <SettingsSkillsInner />
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
