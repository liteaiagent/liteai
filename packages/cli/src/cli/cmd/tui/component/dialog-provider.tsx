import type { ProviderAuthAuthorization } from "@liteai-ai/sdk"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { Clipboard } from "@tui/util/clipboard"
import { map, pipe, sortBy } from "remeda"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useToast } from "../ui/toast"
import { DialogModel } from "./dialog-model"

const PROVIDER_PRIORITY: Record<string, number> = {
  "google-code-assist": 0,
  ai4all: 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const options = createMemo(() => {
    return pipe(
      sync.data.provider_next.all,
      sortBy((x) => PROVIDER_PRIORITY[x.id] ?? 99),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: {
          "google-code-assist": "(Recommended)",
          anthropic: "(API key)",
          openai: "(ChatGPT Plus/Pro or API key)",
        }[provider.id],
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
        async onSelect() {
          const methods = sync.data.provider_auth[provider.id] ?? [
            {
              type: "api",
              label: "API key",
            },
          ]
          let index: number | null = 0
          if (methods.length > 1) {
            index = await new Promise<number | null>((resolve) => {
              dialog.replace(
                () => (
                  <DialogSelect
                    title="Select auth method"
                    options={methods.map((x, index) => ({
                      title: x.label,
                      value: index,
                    }))}
                    onSelect={(option) => resolve(option.value)}
                  />
                ),
                () => resolve(null),
              )
            })
          }
          if (index == null) return
          const method = methods[index]
          if (method.type === "oauth") {
            const inputs: Record<string, string> = {}
            if (method.prompts?.length) {
              for (const prompt of method.prompts) {
                if (prompt.type === "select") {
                  const val = await new Promise<string | null>((resolve) => {
                    dialog.replace(
                      () => (
                        <DialogSelect
                          title={prompt.message}
                          options={prompt.options.map((o) => ({
                            title: o.label,
                            value: o.value,
                            description: o.hint,
                          }))}
                          onSelect={(option) => resolve(option.value as string)}
                        />
                      ),
                      () => resolve(null),
                    )
                  })
                  if (val == null) return
                  inputs[prompt.key] = val
                } else {
                  const val = await DialogPrompt.show(dialog, prompt.message, {
                    placeholder: prompt.placeholder,
                  })
                  if (val == null) return
                  inputs[prompt.key] = val
                }
              }
            }
            const result = await sdk.client.provider.oauth.authorize({
              providerID: provider.id,
              method: index,
              inputs: Object.keys(inputs).length ? inputs : undefined,
            })
            const auth = result.data
            if (auth?.method === "code") {
              dialog.replace(() => (
                <CodeMethod providerID={provider.id} title={method.label} index={index} authorization={auth} />
              ))
            }
            if (auth?.method === "auto") {
              dialog.replace(() => (
                <AutoMethod providerID={provider.id} title={method.label} index={index} authorization={auth} />
              ))
            }
          }
          if (method.type === "api") {
            return dialog.replace(() => <ApiMethod providerID={provider.id} title={method.label} />)
          }
        },
      })),
    )
  })
  return options
}

export function DialogProvider() {
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()
  const toast = useToast()
  const [disconnecting, setDisconnecting] = createSignal<string | null>(null)

  const connectedSet = createMemo(() => new Set(sync.data.provider_next.connected))

  const connectedOptions = createMemo(() =>
    sync.data.provider_next.all
      .filter((p) => connectedSet().has(p.id))
      .map((p) => ({
        title: p.name,
        value: p.id,
        description: disconnecting() === p.id ? "(disconnecting...)" : "✓ connected",
        category: "Connected",
      })),
  )

  const availableOptions = createMemo(() => {
    return pipe(
      sync.data.provider_next.all.filter((p) => !connectedSet().has(p.id)),
      sortBy((x) => PROVIDER_PRIORITY[x.id] ?? 99),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: {
          "google-code-assist": "(Recommended)",
          anthropic: "(API key)",
          openai: "(ChatGPT Plus/Pro or API key)",
        }[provider.id],
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
      })),
    )
  })

  const allOptions = createMemo(() => [...connectedOptions(), ...availableOptions()])

  const connectOptions = createDialogProviderOptions()

  const disconnect = async (providerID: string, name: string) => {
    if (disconnecting()) return
    setDisconnecting(providerID)
    const { error } = await sdk.client.auth.remove({ providerID })
    if (error) {
      setDisconnecting(null)
      toast.show({ variant: "error", message: `Failed to disconnect ${name}` })
      return
    }
    await sdk.client.project.instance.dispose({ projectID: sdk.projectID })
    await sync.bootstrap()
    setDisconnecting(null)
    toast.show({ variant: "info", message: `Disconnected ${name}` })
  }

  const keybinds = createMemo(() => [
    {
      keybind: { name: "d", ctrl: true, meta: false, shift: false, leader: false },
      title: "disconnect",
      disabled: false,
      onTrigger: (option: { value: string; title: string }) => {
        if (!connectedSet().has(option.value)) return
        disconnect(option.value, option.title)
      },
    },
  ])

  return (
    <DialogSelect
      title="Providers"
      options={allOptions()}
      keybind={keybinds()}
      footerContent={
        connectedOptions().length > 0 ? (
          <text fg={theme.textMuted}>↑↓ navigate · Enter connect · ctrl+d disconnect</text>
        ) : undefined
      }
      onSelect={(option) => {
        if (connectedSet().has(option.value)) return
        const match = connectOptions().find((o) => o.value === option.value)
        if (match?.onSelect) match.onSelect()
      }}
    />
  )
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()

  useKeyboard((evt) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      const code = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
      Clipboard.copy(code)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error)
    }
  })

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      dialog.clear()
      return
    }
    await sdk.client.project.instance.dispose({ projectID: sdk.projectID })
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: TUI element, not HTML */}
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Enter JSON"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.project.instance.dispose({ projectID: sdk.projectID })
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={
        {
          "google-code-assist": (
            <box gap={1}>
              <text fg={theme.textMuted}>
                Google Code Assist gives you free access to Gemini models for coding, powered by your Google account.
              </text>
              <text fg={theme.text}>
                Sign in at <span style={{ fg: theme.primary }}>https://idx.google.com</span> to get a key
              </text>
            </box>
          ),
        }[props.providerID] ?? undefined
      }
      onConfirm={async (value) => {
        if (!value) return
        await sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
          },
        })
        await sdk.client.project.instance.dispose({ projectID: sdk.projectID })
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}
