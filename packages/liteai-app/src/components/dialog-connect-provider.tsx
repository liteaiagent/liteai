import { Button } from "@liteai/ui/button"
import { useDialog } from "@liteai/ui/context/dialog"
import { Dialog } from "@liteai/ui/dialog"
import { Icon } from "@liteai/ui/icon"
import { IconButton } from "@liteai/ui/icon-button"
import { List, type ListRef } from "@liteai/ui/list"
import { ProviderIcon } from "@liteai/ui/provider-icon"
import { Spinner } from "@liteai/ui/spinner"
import { TextField } from "@liteai/ui/text-field"
import { showToast } from "@liteai/ui/toast"
import type { ProviderAuthAuthorization } from "@liteai-ai/sdk/client"
import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { DialogSelectProvider } from "./dialog-select-provider"

export function DialogConnectProvider(props: { provider: string }) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const language = useLanguage()

  const alive = { value: true }
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }

  onCleanup(() => {
    alive.value = false
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  })

  const provider = createMemo(
    () =>
      globalSync.data.provider.all.find((x) => x.id === props.provider) ?? { id: props.provider, name: props.provider },
  )
  const methods = createMemo(
    () =>
      globalSync.data.provider_auth[props.provider] ?? [
        {
          type: "api",
          label: language.t("provider.connect.method.apiKey"),
        },
      ],
  )
  const [store, setStore] = createStore({
    methodIndex: undefined as undefined | number,
    authorization: undefined as undefined | ProviderAuthAuthorization,
    state: "pending" as undefined | "pending" | "complete" | "error" | "prompts",
    error: undefined as string | undefined,
  })

  type Action =
    | { type: "method.select"; index: number }
    | { type: "method.reset" }
    | { type: "method.prompts" }
    | { type: "auth.pending" }
    | { type: "auth.complete"; authorization: ProviderAuthAuthorization }
    | { type: "auth.error"; error: string }

  function dispatch(action: Action) {
    setStore(
      produce((draft) => {
        if (action.type === "method.select") {
          draft.methodIndex = action.index
          draft.authorization = undefined
          draft.state = undefined
          draft.error = undefined
          return
        }
        if (action.type === "method.reset") {
          draft.methodIndex = undefined
          draft.authorization = undefined
          draft.state = undefined
          draft.error = undefined
          return
        }
        if (action.type === "method.prompts") {
          draft.state = "prompts"
          draft.error = undefined
          return
        }
        if (action.type === "auth.pending") {
          draft.state = "pending"
          draft.error = undefined
          return
        }
        if (action.type === "auth.complete") {
          draft.state = "complete"
          draft.authorization = action.authorization
          draft.error = undefined
          return
        }
        draft.state = "error"
        draft.error = action.error
      }),
    )
  }

  const method = createMemo(() => (store.methodIndex !== undefined ? methods().at(store.methodIndex) : undefined))

  const methodLabel = (value?: { type?: string; label?: string }) => {
    if (!value) return ""
    if (value.type === "api") return language.t("provider.connect.method.apiKey")
    return value.label ?? ""
  }

  function formatError(value: unknown, fallback: string): string {
    if (value && typeof value === "object" && "data" in value) {
      const data = (value as { data?: { message?: unknown } }).data
      if (typeof data?.message === "string" && data.message) return data.message
    }
    if (value && typeof value === "object" && "error" in value) {
      const nested = formatError((value as { error?: unknown }).error, "")
      if (nested) return nested
    }
    if (value && typeof value === "object" && "message" in value) {
      const message = (value as { message?: unknown }).message
      if (typeof message === "string" && message) return message
    }
    if (value instanceof Error && value.message) return value.message
    if (typeof value === "string" && value) return value
    return fallback
  }

  async function startAuthorize(index: number, inputs?: Record<string, string>) {
    dispatch({ type: "auth.pending" })
    const start = Date.now()
    await globalSDK.client.provider.oauth
      .authorize(
        {
          providerID: props.provider,
          method: index,
          inputs: inputs && Object.keys(inputs).length ? inputs : undefined,
        },
        { throwOnError: true },
      )
      .then((x) => {
        if (!alive.value) return
        const elapsed = Date.now() - start
        const delay = 1000 - elapsed

        if (delay > 0) {
          if (timer.current !== undefined) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            timer.current = undefined
            if (!alive.value) return
            if (x.data) dispatch({ type: "auth.complete", authorization: x.data })
          }, delay)
          return
        }
        if (x.data) dispatch({ type: "auth.complete", authorization: x.data })
      })
      .catch((e) => {
        if (!alive.value) return
        dispatch({ type: "auth.error", error: formatError(e, language.t("common.requestFailed")) })
      })
  }

  async function selectMethod(index: number) {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }

    const method = methods()[index]
    dispatch({ type: "method.select", index })

    if (method.type === "oauth") {
      if (method.prompts?.length) {
        dispatch({ type: "method.prompts" })
        return
      }
      await startAuthorize(index)
    }
  }

  let listRef: ListRef | undefined
  function handleKey(e: KeyboardEvent) {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      return
    }
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  onMount(() => {
    if (methods().length === 1) {
      selectMethod(0)
    }
  })

  async function complete() {
    await globalSDK.client.global.dispose()
    dialog.close()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.connect.toast.connected.title", { provider: provider().name }),
      description: language.t("provider.connect.toast.connected.description", { provider: provider().name }),
    })
  }

  function goBack() {
    if (methods().length === 1) {
      dialog.show(() => <DialogSelectProvider />)
      return
    }
    if (store.authorization) {
      dispatch({ type: "method.reset" })
      return
    }
    if (store.methodIndex !== undefined) {
      dispatch({ type: "method.reset" })
      return
    }
    dialog.show(() => <DialogSelectProvider />)
  }

  function MethodSelection() {
    return (
      <>
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.selectMethod", { provider: provider().name })}
        </div>
        <div>
          <List
            ref={(ref) => {
              listRef = ref
            }}
            items={methods}
            key={(m) => m?.label}
            onSelect={async (selected, index) => {
              if (!selected) return
              selectMethod(index)
            }}
          >
            {(i) => (
              <div class="w-full flex items-center gap-x-2">
                <div class="w-4 h-2 rounded-[1px] bg-input-base shadow-xs-border-base flex items-center justify-center">
                  <div class="w-2.5 h-0.5 ml-0 bg-icon-strong-base hidden" data-slot="list-item-extra-icon" />
                </div>
                <span>{methodLabel(i)}</span>
              </div>
            )}
          </List>
        </div>
      </>
    )
  }

  function PromptsView() {
    const idx = store.methodIndex ?? 0
    const m = methods()[idx]
    const prompts = m.prompts ?? []
    const [values, setValues] = createStore<Record<string, string>>({})

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()
      await startAuthorize(idx, { ...values })
    }

    return (
      <div class="flex flex-col gap-6">
        <div class="text-14-regular text-text-base">{m.label}</div>
        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
          {prompts.map((p) => (
            <Show
              when={p.type === "text"}
              fallback={
                <div class="w-full flex flex-col gap-1">
                  <label for={p.key} class="text-13-medium text-text-base">
                    {p.message}
                  </label>
                  <select
                    id={p.key}
                    class="w-full h-8 rounded-md bg-input-base text-text-base border border-border-base px-2"
                    value={values[p.key] ?? ""}
                    onChange={(e) => setValues(p.key, e.currentTarget.value)}
                  >
                    <option value="" disabled>
                      Select...
                    </option>
                    {"options" in p &&
                      p.options?.map((o) => (
                        <option value={o.value}>
                          {o.label}
                          {o.hint ? ` (${o.hint})` : ""}
                        </option>
                      ))}
                  </select>
                </div>
              }
            >
              <TextField
                autofocus={prompts.indexOf(p) === 0}
                label={p.message}
                placeholder={"placeholder" in p ? p.placeholder : undefined}
                value={values[p.key] ?? ""}
                onChange={(v) => setValues(p.key, v)}
              />
            </Show>
          ))}
          <Button class="w-auto" type="submit" size="large" variant="primary">
            {language.t("common.submit")}
          </Button>
        </form>
      </div>
    )
  }

  function ApiAuthView() {
    const [formStore, setFormStore] = createStore({
      value: "",
      error: undefined as string | undefined,
    })

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()

      const form = e.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const apiKey = formData.get("apiKey") as string

      if (!apiKey?.trim() && props.provider !== "opencode") {
        setFormStore("error", language.t("provider.connect.apiKey.required"))
        return
      }

      setFormStore("error", undefined)
      await globalSDK.client.auth.set({
        providerID: props.provider,
        auth: {
          type: "api",
          key: apiKey?.trim() || "public",
        },
      })
      await complete()
    }

    return (
      <div class="flex flex-col gap-6">
        <Switch>
          <Match when={provider().id === "opencode"}>
            <div class="flex flex-col gap-4">
              <div class="text-14-regular text-text-base">{language.t("provider.connect.opencodeZen.line1")}</div>
              <div class="text-14-regular text-text-base">{language.t("provider.connect.opencodeZen.line2")}</div>
              <div class="text-14-regular text-text-base">
                {language.t("provider.connect.opencodeZen.visit.prefix")}
                <Link href="https://opencode.ai/zen" tabIndex={-1}>
                  {language.t("provider.connect.opencodeZen.visit.link")}
                </Link>
                {language.t("provider.connect.opencodeZen.visit.suffix")}
              </div>
            </div>
          </Match>
          <Match when={true}>
            <div class="text-14-regular text-text-base">
              {language.t("provider.connect.apiKey.description", { provider: provider().name })}
            </div>
          </Match>
        </Switch>
        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
          <TextField
            autofocus
            type="text"
            label={language.t("provider.connect.apiKey.label", { provider: provider().name })}
            placeholder={
              props.provider === "opencode"
                ? language.t("provider.connect.apiKey.placeholder.optional")
                : language.t("provider.connect.apiKey.placeholder")
            }
            name="apiKey"
            value={formStore.value}
            onChange={(v) => setFormStore("value", v)}
            validationState={formStore.error ? "invalid" : undefined}
            error={formStore.error}
          />
          <div class="flex items-center gap-3">
            <Button class="w-auto" type="submit" size="large" variant="primary">
              {language.t("common.submit")}
            </Button>
            <Show when={props.provider === "opencode" && !formStore.value?.trim()}>
              <span class="text-13-regular text-text-base">{language.t("provider.connect.opencodeZen.freeHint")}</span>
            </Show>
          </div>
        </form>
      </div>
    )
  }

  function OAuthCodeView() {
    const [formStore, setFormStore] = createStore({
      value: "",
      error: undefined as string | undefined,
    })

    onMount(() => {
      if (store.authorization?.method === "code" && store.authorization?.url) {
        platform.openLink(store.authorization.url)
      }
    })

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()

      const form = e.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const code = formData.get("code") as string

      if (!code?.trim()) {
        setFormStore("error", language.t("provider.connect.oauth.code.required"))
        return
      }

      setFormStore("error", undefined)
      const result = await globalSDK.client.provider.oauth
        .callback({
          providerID: props.provider,
          method: store.methodIndex,
          code,
        })
        .then((value) => (value.error ? { ok: false as const, error: value.error } : { ok: true as const }))
        .catch((error) => ({ ok: false as const, error }))
      if (result.ok) {
        await complete()
        return
      }
      setFormStore("error", formatError(result.error, language.t("provider.connect.oauth.code.invalid")))
    }

    return (
      <div class="flex flex-col gap-6">
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.oauth.code.visit.prefix")}
          <Link href={store.authorization?.url ?? ""}>{language.t("provider.connect.oauth.code.visit.link")}</Link>
          {language.t("provider.connect.oauth.code.visit.suffix", { provider: provider().name })}
        </div>
        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
          <TextField
            autofocus
            type="text"
            label={language.t("provider.connect.oauth.code.label", { method: method()?.label ?? "" })}
            placeholder={language.t("provider.connect.oauth.code.placeholder")}
            name="code"
            value={formStore.value}
            onChange={(v) => setFormStore("value", v)}
            validationState={formStore.error ? "invalid" : undefined}
            error={formStore.error}
          />
          <Button class="w-auto" type="submit" size="large" variant="primary">
            {language.t("common.submit")}
          </Button>
        </form>
      </div>
    )
  }

  function OAuthAutoView() {
    const code = createMemo(() => {
      const instructions = store.authorization?.instructions
      if (instructions?.includes(":")) {
        return instructions.split(":")[1]?.trim()
      }
      return instructions
    })

    onMount(() => {
      void (async () => {
        if (store.authorization?.url) {
          platform.openLink(store.authorization.url)
        }

        const result = await globalSDK.client.provider.oauth
          .callback({
            providerID: props.provider,
            method: store.methodIndex,
          })
          .then((value) => (value.error ? { ok: false as const, error: value.error } : { ok: true as const }))
          .catch((error) => ({ ok: false as const, error }))

        if (!alive.value) return

        if (!result.ok) {
          const message = formatError(result.error, language.t("common.requestFailed"))
          dispatch({ type: "auth.error", error: message })
          return
        }

        await complete()
      })()
    })

    return (
      <div class="flex flex-col gap-6">
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.oauth.auto.visit.prefix")}
          <Link href={store.authorization?.url ?? ""}>{language.t("provider.connect.oauth.auto.visit.link")}</Link>
          {language.t("provider.connect.oauth.auto.visit.suffix", { provider: provider().name })}
        </div>
        <TextField
          label={language.t("provider.connect.oauth.auto.confirmationCode")}
          class="font-mono"
          value={code()}
          readOnly
          copyable
        />
        <div class="text-14-regular text-text-base flex items-center gap-4">
          <Spinner />
          <span>{language.t("provider.connect.status.waiting")}</span>
        </div>
      </div>
    )
  }

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id={props.provider} class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">
            <Switch>
              <Match when={props.provider === "anthropic" && method()?.label?.toLowerCase().includes("max")}>
                {language.t("provider.connect.title.anthropicProMax")}
              </Match>
              <Match when={true}>{language.t("provider.connect.title", { provider: provider().name })}</Match>
            </Switch>
          </div>
        </div>
        <div class="px-2.5 pb-10 flex flex-col gap-6">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: event delegation catcher */}
          <div onKeyDown={handleKey} autofocus={store.methodIndex === undefined ? true : undefined}>
            <Switch>
              <Match when={store.methodIndex === undefined}>
                <MethodSelection />
              </Match>
              <Match when={store.state === "prompts"}>
                <PromptsView />
              </Match>
              <Match when={store.state === "pending"}>
                <div class="text-14-regular text-text-base">
                  <div class="flex items-center gap-x-2">
                    <Spinner />
                    <span>{language.t("provider.connect.status.inProgress")}</span>
                  </div>
                </div>
              </Match>
              <Match when={store.state === "error"}>
                <div class="text-14-regular text-text-base">
                  <div class="flex items-center gap-x-2">
                    <Icon name="circle-ban-sign" class="text-icon-critical-base" />
                    <span>{language.t("provider.connect.status.failed", { error: store.error ?? "" })}</span>
                  </div>
                </div>
              </Match>
              <Match when={method()?.type === "api"}>
                <ApiAuthView />
              </Match>
              <Match when={method()?.type === "oauth"}>
                <Switch>
                  <Match when={store.authorization?.method === "code"}>
                    <OAuthCodeView />
                  </Match>
                  <Match when={store.authorization?.method === "auto"}>
                    <OAuthAutoView />
                  </Match>
                </Switch>
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
