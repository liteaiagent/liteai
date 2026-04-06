import { Dialog } from "@liteai/ui/dialog"
import { Icon } from "@liteai/ui/icon"
import { Tabs } from "@liteai/ui/tabs"
import type { Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { SettingsAgents } from "./settings-agents"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsMcp } from "./settings-mcp"
import { SettingsModels } from "./settings-models"
import { SettingsPlugins } from "./settings-plugins"
import { SettingsProviders } from "./settings-providers"
import { SettingsServer } from "./settings-server"
import { SettingsSkills } from "./settings-skills"
import { SettingsTools } from "./settings-tools"

export const DialogSettings: Component<{ tab?: string }> = (props) => {
  const language = useLanguage()

  return (
    <Dialog size="x-large" transition>
      <Tabs
        orientation="vertical"
        variant="settings"
        defaultValue={props.tab ?? "general"}
        class="h-[600px] settings-dialog"
      >
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </Tabs.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="server">
                      <Icon name="status" />
                      {language.t("settings.server.title") ?? "Server Config"}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="mcp">
                      <Icon name="mcp" />
                      {language.t("settings.mcp.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="skills">
                      <Icon name="brain" />
                      {language.t("settings.skills.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="agents">
                      <Icon name="task" />
                      {language.t("settings.agents.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="plugins">
                      <Icon name="brain" />
                      Plugins
                    </Tabs.Trigger>
                    <Tabs.Trigger value="tools">
                      <Icon name="task" />
                      {language.t("settings.tools.title") ?? "Tools"}
                    </Tabs.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{language.t("app.name.desktop")}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="server" class="no-scrollbar">
          <SettingsServer />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
        <Tabs.Content value="mcp" class="no-scrollbar">
          <SettingsMcp />
        </Tabs.Content>
        <Tabs.Content value="skills" class="no-scrollbar">
          <SettingsSkills />
        </Tabs.Content>
        <Tabs.Content value="agents" class="no-scrollbar">
          <SettingsAgents />
        </Tabs.Content>
        <Tabs.Content value="plugins" class="no-scrollbar">
          <SettingsPlugins />
        </Tabs.Content>
        <Tabs.Content value="tools" class="no-scrollbar">
          <SettingsTools />
        </Tabs.Content>
      </Tabs>
    </Dialog>
  )
}
