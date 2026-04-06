import { Switch } from "@liteai/ui/switch"
import { TextField } from "@liteai/ui/text-field"
import type { Component, JSX } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SettingsList } from "./settings-list"

export const SettingsServer: Component = () => {
  const language = useLanguage()
  const sync = useGlobalSync()

  const config = () => sync.data.config

  const updateConfig = (patch: Parameters<typeof sync.updateConfig>[0]) => {
    sync.updateConfig(patch)
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.server") ?? "Server Config"}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">
            {language.t("settings.server.section.telemetry") ?? "Telemetry"}
          </h3>

          <SettingsList>
            <SettingsRow
              title={language.t("settings.server.telemetry.enabled.title") ?? "Enable Telemetry"}
              description={
                language.t("settings.server.telemetry.enabled.description") ??
                "When enabled, LiteAI provides observability data."
              }
            >
              <Switch
                checked={!(config().telemetry?.disabled ?? false)}
                onChange={(enabled) => updateConfig({ telemetry: { disabled: !enabled } })}
              />
            </SettingsRow>

            <SettingsRow title="Langfuse Public Key" description="Public Key for Langfuse observability.">
              <TextField
                value={config().telemetry?.langfuse?.publicKey ?? ""}
                onChange={(enabled) => updateConfig({ telemetry: { langfuse: { publicKey: enabled } } })}
              />
            </SettingsRow>

            <SettingsRow
              title="Langfuse Secret Key"
              description="Secret Key for Langfuse observability (hidden once saved)."
            >
              <TextField
                type="password"
                value={config().telemetry?.langfuse?.secretKey ?? ""}
                onChange={(enabled) => updateConfig({ telemetry: { langfuse: { secretKey: enabled } } })}
              />
            </SettingsRow>

            <SettingsRow
              title="Langfuse Base URL"
              description="Host URL for your Langfuse instance (leave blank for cloud)."
            >
              <TextField
                value={config().telemetry?.langfuse?.baseUrl ?? ""}
                onChange={(enabled) => updateConfig({ telemetry: { langfuse: { baseUrl: enabled } } })}
              />
            </SettingsRow>
          </SettingsList>
        </div>
      </div>
    </div>
  )
}

const SettingsRow: Component<{
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
