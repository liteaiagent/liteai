import { Button } from "@liteai/ui/button"
import { useDialog } from "@liteai/ui/context/dialog"
import { Icon } from "@liteai/ui/icon"
import { StatusPopoverLayout } from "@liteai/ui/status-popover-layout"
import { Switch } from "@liteai/ui/switch"
import { showToast } from "@liteai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { type Accessor, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { toProjectID } from "@/utils/project-id"

const pollMs = 10_000



const useMcpToggle = (input: {
  sync: ReturnType<typeof useSync>
  sdk: ReturnType<typeof useSDK>
  language: ReturnType<typeof useLanguage>
}) => {
  const [loading, setLoading] = createSignal<string | null>(null)

  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)

    try {
      const status = input.sync.data.mcp[name]
      await (status?.status === "connected"
        ? input.sdk.client.project.mcp.disconnect({ name, projectID: toProjectID(input.sdk.directory) })
        : input.sdk.client.project.mcp.connect({ name, projectID: toProjectID(input.sdk.directory) }))
      const result = await input.sdk.client.project.mcp.status({ projectID: toProjectID(input.sdk.directory) })
      if (result.data) input.sync.set("mcp", result.data)
    } catch (err) {
      showToast({
        variant: "error",
        title: input.language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoading(null)
    }
  }

  return { loading, toggle }
}

export function StatusPopover() {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()

  const [shown, setShown] = createSignal(false)
  const mcp = useMcpToggle({ sync, sdk, language })
  const mcpNames = createMemo(() => Object.keys(sync.data.mcp ?? {}).sort((a, b) => a.localeCompare(b)))
  const mcpStatus = (name: string) => sync.data.mcp?.[name]?.status
  const mcpConnected = createMemo(() => mcpNames().filter((name) => mcpStatus(name) === "connected").length)
  const lspItems = createMemo(() => sync.data.lsp ?? [])
  const lspCount = createMemo(() => lspItems().length)

  const overallHealthy = createMemo(() => {
    const anyMcpIssue = mcpNames().some((name) => {
      const status = mcpStatus(name)
      return status !== "connected" && status !== "disabled"
    })
    return !anyMcpIssue
  })

  return (
    <StatusPopoverLayout
      open={shown()}
      onOpenChange={setShown}
      overallHealthy={overallHealthy()}
      mcpCount={mcpConnected()}
      mcpLabel={language.t("status.popover.tab.mcp")}
      lspCount={lspCount()}
      lspLabel={language.t("status.popover.tab.lsp")}
      mcpContent={
        <Show
          when={mcpNames().length > 0}
          fallback={
            <div class="text-14-regular text-text-base text-center my-auto">{language.t("dialog.mcp.empty")}</div>
          }
        >
          <For each={mcpNames()}>
            {(name) => {
              const status = () => mcpStatus(name)
              const enabled = () => status() === "connected"
              return (
                <button
                  type="button"
                  class="flex items-center gap-2 w-full h-8 pl-3 pr-2 py-1 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                  onClick={() => mcp.toggle(name)}
                  disabled={mcp.loading() === name}
                >
                  <div
                    classList={{
                      "size-1.5 rounded-full shrink-0": true,
                      "bg-icon-success-base": status() === "connected",
                      "bg-icon-critical-base": status() === "failed",
                      "bg-border-weak-base": status() === "disabled",
                      "bg-icon-warning-base": status() === "needs_auth" || status() === "needs_client_registration",
                    }}
                  />
                  <span class="text-14-regular text-text-base truncate flex-1">{name}</span>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation layer */}
                  <div
                    role="presentation"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Switch checked={enabled()} disabled={mcp.loading() === name} onChange={() => mcp.toggle(name)} />
                  </div>
                </button>
              )
            }}
          </For>
        </Show>
      }
      lspContent={
        <Show
          when={lspItems().length > 0}
          fallback={
            <div class="text-14-regular text-text-base text-center my-auto">{language.t("dialog.lsp.empty")}</div>
          }
        >
          <For each={lspItems()}>
            {(item) => (
              <div class="flex items-center gap-2 w-full px-2 py-1">
                <div
                  classList={{
                    "size-1.5 rounded-full shrink-0": true,
                    "bg-icon-success-base": item.status === "connected",
                    "bg-icon-critical-base": item.status === "error",
                  }}
                />
                <span class="text-14-regular text-text-base truncate">{item.name || item.id}</span>
              </div>
            )}
          </For>
        </Show>
      }
    />
  )
}
