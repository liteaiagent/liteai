import { Button } from "@liteai/ui/button"
import { useDialog } from "@liteai/ui/context/dialog"
import { Dialog } from "@liteai/ui/dialog"
import { List } from "@liteai/ui/list"
import { ProviderIcon } from "@liteai/ui/provider-icon"
import { Switch } from "@liteai/ui/switch"
import { Tooltip } from "@liteai/ui/tooltip"
import type { Component } from "solid-js"
import { useLanguage } from "@/context/language"
import type { useLocal } from "@/context/local"
import { popularProviders } from "@/hooks/use-providers"
import { DialogSelectProvider } from "./dialog-select-provider"

type ModelState = ReturnType<typeof useLocal>["model"]

export const DialogManageModels: Component<{ model: ModelState }> = (props) => {
  const model = props.model
  const language = useLanguage()
  const dialog = useDialog()

  const handleConnectProvider = () => {
    dialog.show(() => <DialogSelectProvider />)
  }
  const providerRank = (id: string) => popularProviders.indexOf(id)
  const providerList = (providerID: string) => model.list().filter((x) => x.provider.id === providerID)
  const providerVisible = (providerID: string) =>
    providerList(providerID).every((x) => model.visible({ modelID: x.id, providerID: x.provider.id }))
  const setProviderVisibility = (providerID: string, checked: boolean) => {
    providerList(providerID).forEach((x) => {
      model.setVisibility({ modelID: x.id, providerID: x.provider.id }, checked)
    })
  }

  return (
    <Dialog
      title={language.t("dialog.model.manage")}
      description={language.t("dialog.model.manage.description")}
      action={
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={handleConnectProvider}>
          {language.t("command.provider.connect")}
        </Button>
      }
    >
      <List
        search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.model.empty")}
        key={(x) => `${x?.provider?.id}:${x?.id}`}
        items={model.list()}
        filterKeys={["provider.name", "name", "id"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        groupBy={(x) => x.provider.id}
        groupHeader={(group) => {
          const provider = group.items[0].provider
          return (
            <div class="flex items-center justify-between w-full">
              <div class="flex items-center gap-1.5 text-text-weak">
                <ProviderIcon id={provider.id} class="size-3.5 shrink-0 opacity-80" />
                <span class="font-medium">{provider.name}</span>
              </div>
              <Tooltip
                placement="top"
                value={language.t("dialog.model.manage.provider.toggle", { provider: provider.name })}
              >
                <Switch
                  class="-mr-1"
                  checked={providerVisible(provider.id)}
                  onChange={(checked) => setProviderVisibility(provider.id, checked)}
                  hideLabel
                >
                  {provider.name}
                </Switch>
              </Tooltip>
            </div>
          )
        }}
        sortGroupsBy={(a, b) => {
          const aRank = providerRank(a.items[0].provider.id)
          const bRank = providerRank(b.items[0].provider.id)
          const aPopular = aRank >= 0
          const bPopular = bRank >= 0
          if (aPopular && !bPopular) return -1
          if (!aPopular && bPopular) return 1
          return aRank - bRank
        }}
        onSelect={(x) => {
          if (!x) return
          const key = { modelID: x.id, providerID: x.provider.id }
          model.setVisibility(key, !model.visible(key))
        }}
      >
        {(i) => (
          <div class="w-full flex items-center justify-between gap-x-3">
            <span>{i.name}</span>
            <Switch
              onClick={(e: Event) => e.stopPropagation()}
              onKeyDown={(e: KeyboardEvent) => e.stopPropagation()}
              checked={!!model.visible({ modelID: i.id, providerID: i.provider.id })}
              onChange={(checked) => {
                model.setVisibility({ modelID: i.id, providerID: i.provider.id }, checked)
              }}
            />
          </div>
        )}
      </List>
    </Dialog>
  )
}
