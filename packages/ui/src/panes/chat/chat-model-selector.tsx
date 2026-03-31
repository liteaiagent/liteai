import { Popover as Kobalte } from "@kobalte/core/popover"
import { Button } from "@liteai/ui/button"
import { Icon } from "@liteai/ui/icon"
import { List } from "@liteai/ui/list"
import { Tag } from "@liteai/ui/tag"
import { Tooltip } from "@liteai/ui/tooltip"
import { type Component, createMemo, type JSX, Show, type ValidComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { useSelectionController } from "../controllers"
import type { SelectionController } from "../controllers/selection-controller"
import { useLanguage } from "../shared/language"

/** Well-known provider IDs for sort ordering in the model selector. */
export const popularProviders = ["anthropic", "google", "openai", "google-code-assist", "ai4all"]

type ModelState = SelectionController["model"]

const isFree = (provider: string, cost: { input: number } | undefined) =>
  provider === "opencode" && (!cost || cost.input === 0)

type ChatModelSelectorProps = {
  provider?: string
  model?: ModelState
  children?: JSX.Element
  triggerAs?: ValidComponent
  /** Callback when user wants to manage models (web shows a dialog, vscode can show a command) */
  onManageModels?: () => void
  /** Callback when user wants to connect a new provider */
  onConnectProvider?: () => void
}

/**
 * Portable model selector popover for use in ChatPane.
 * Unlike the web ModelSelectorPopover, this doesn't import dialog chains,
 * instead uses callback props for management actions.
 */
export const ChatModelSelector: Component<ChatModelSelectorProps> = (props) => {
  const model = () => props.model ?? useSelectionController().model
  const language = useLanguage()

  const [store, setStore] = createStore<{
    open: boolean
    dismiss: "escape" | "outside" | null
  }>({
    open: false,
    dismiss: null,
  })

  const models = createMemo(() =>
    model()
      .list()
      .filter((m) => model().visible({ modelID: m.id, providerID: m.provider.id }))
      .filter((m) => (props.provider ? m.provider.id === props.provider : true)),
  )

  return (
    <Kobalte
      open={store.open}
      onOpenChange={(next) => {
        if (next) setStore("dismiss", null)
        setStore("open", next)
      }}
      modal={false}
      placement="top-start"
      gutter={4}
    >
      <Kobalte.Trigger as={props.triggerAs ?? "div"}>{props.children}</Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class="w-72 h-80 flex flex-col p-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden"
          onEscapeKeyDown={(event) => {
            setStore("dismiss", "escape")
            setStore("open", false)
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDownOutside={() => {
            setStore("dismiss", "outside")
            setStore("open", false)
          }}
          onFocusOutside={() => {
            setStore("dismiss", "outside")
            setStore("open", false)
          }}
          onCloseAutoFocus={(event) => {
            if (store.dismiss === "outside") event.preventDefault()
            setStore("dismiss", null)
          }}
        >
          <Kobalte.Title class="sr-only">{language.t("dialog.model.select.title")}</Kobalte.Title>
          <List
            class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 p-1"
            search={{
              placeholder: language.t("dialog.model.search.placeholder"),
              autofocus: true,
              action: (
                <div class="flex items-center gap-1">
                  <Show when={props.onConnectProvider}>
                    <Tooltip placement="top" value={language.t("command.provider.connect")}>
                      <Button
                        variant="ghost"
                        class="size-6 p-0"
                        aria-label={language.t("command.provider.connect")}
                        onClick={() => {
                          setStore("open", false)
                          props.onConnectProvider?.()
                        }}
                      >
                        <Icon name="plus-small" size="normal" />
                      </Button>
                    </Tooltip>
                  </Show>
                  <Show when={props.onManageModels}>
                    <Tooltip placement="top" value={language.t("dialog.model.manage")}>
                      <Button
                        variant="ghost"
                        class="size-6 p-0"
                        aria-label={language.t("dialog.model.manage")}
                        onClick={() => {
                          setStore("open", false)
                          props.onManageModels?.()
                        }}
                      >
                        <Icon name="sliders" size="normal" />
                      </Button>
                    </Tooltip>
                  </Show>
                </div>
              ),
            }}
            emptyMessage={language.t("dialog.model.empty")}
            key={(x) => `${x.provider.id}:${x.id}`}
            items={models}
            current={model().current()}
            filterKeys={["provider.name", "name", "id"]}
            sortBy={(a, b) => a.name.localeCompare(b.name)}
            groupBy={(x) => x.provider.name}
            sortGroupsBy={(a, b) => {
              const aProvider = a.items[0].provider.id
              const bProvider = b.items[0].provider.id
              if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
              if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
              return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
            }}
            onSelect={(x) => {
              model().set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
                recent: true,
              })
              setStore("open", false)
            }}
          >
            {(i) => (
              <div class="w-full flex items-center gap-x-2 text-13-regular">
                <span class="truncate">{i.name}</span>
                <Show when={isFree(i.provider.id, i.cost)}>
                  <Tag>{language.t("model.tag.free")}</Tag>
                </Show>
                <Show when={i.latest}>
                  <Tag>{language.t("model.tag.latest")}</Tag>
                </Show>
              </div>
            )}
          </List>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
