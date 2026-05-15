import { Box, type Color, Text } from "@liteai/ink"
import type { ProviderAuthAuthorization } from "@liteai/sdk"
import { useEffect, useMemo, useState } from "react"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useKeybindings } from "../keybindings/use-keybinding"
import { useAppActions, useAppState } from "../state"
import { DialogPrompt } from "../ui/dialog-prompt"
import type { DialogSelectOption } from "../ui/dialog-select"
import { DialogSelect } from "../ui/dialog-select"
import { DialogModel } from "./dialog-model"

const PROVIDER_PRIORITY: Record<string, number> = {
  "google-code-assist": 0,
  ai4all: 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

export function useDialogProviderOptions(
  onNavigate: (
    view:
      | { type: "method"; providerID: string; methodIndex: number; method: any }
      | { type: "api"; providerID: string; title: string }
      | { type: "select-method"; providerID: string; methods: any[] },
  ) => void,
) {
  const provider_next = useAppState((s) => s.provider_next)
  const provider_auth = useAppState((s) => s.provider_auth)
  const sdk = useSDK()

  const options = useMemo(() => {
    const allProviders = provider_next?.all || []
    const sorted = [...allProviders].sort((a, b) => {
      const pA = PROVIDER_PRIORITY[a.id] ?? 99
      const pB = PROVIDER_PRIORITY[b.id] ?? 99
      if (pA !== pB) return pA - pB
      return a.name.localeCompare(b.name)
    })

    return sorted.map(
      (provider) =>
        ({
          title: provider.name,
          value: provider.id,
          description: (
            {
              "google-code-assist": "(Recommended)",
              anthropic: "(API key)",
              openai: "(ChatGPT Plus/Pro or API key)",
            } as Record<string, string>
          )[provider.id],
          category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
          onSelect: () => {
            const methods = provider_auth?.[provider.id] ?? [{ type: "api", label: "API key" }]

            if (methods.length === 1) {
              const method = methods[0]
              if (method.type === "api") {
                onNavigate({ type: "api", providerID: provider.id, title: method.label })
                return
              }
            }

            onNavigate({ type: "select-method", providerID: provider.id, methods })
          },
        }) as DialogSelectOption<string>,
    )
  }, [provider_next?.all, provider_auth, sdk, onNavigate])

  return options
}

// Complex OAuth flows implemented using a sequential component
function MethodRunner({
  providerID,
  methodIndex,
  method,
  onNavigate,
  onClose,
}: {
  providerID: string
  methodIndex: number
  method: import("@liteai/sdk").ProviderAuthMethod
  onNavigate: (view: any) => void
  onClose?: () => void
}) {
  const sdk = useSDK()
  const [step, setStep] = useState(0)
  const [inputs, setInputs] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!method.prompts || step >= method.prompts.length) {
      sdk.client.provider.oauth
        .authorize({
          providerID,
          method: methodIndex,
          inputs: Object.keys(inputs).length ? inputs : undefined,
        })
        .then((result) => {
          const auth = result.data
          if (auth?.method === "code") {
            onNavigate({ type: "code", providerID, title: method.label, index: methodIndex, authorization: auth })
          } else if (auth?.method === "auto") {
            onNavigate({ type: "auto", providerID, title: method.label, index: methodIndex, authorization: auth })
          }
        })
    }
  }, [step, method.prompts, inputs, sdk, providerID, methodIndex, method.label, onNavigate])

  if (!method.prompts || step >= method.prompts.length) {
    return <Text>Loading authorization...</Text>
  }

  const prompt = method.prompts[step]

  if (prompt.type === "select") {
    return (
      <DialogSelect
        title={prompt.message}
        options={prompt.options.map((o: { label: string; value: string; hint?: string }) => ({
          title: o.label,
          value: o.value,
          description: o.hint,
        }))}
        onEscape={onClose}
        onSelect={(option) => {
          setInputs((prev) => ({ ...prev, [prompt.key]: option.value }))
          setStep((s) => s + 1)
        }}
      />
    )
  }

  return (
    <DialogPrompt
      title={prompt.message}
      placeholder={prompt.placeholder}
      onCancel={onClose}
      onConfirm={(value) => {
        setInputs((prev) => ({ ...prev, [prompt.key]: value }))
        setStep((s) => s + 1)
      }}
    />
  )
}

export function DialogProvider({ onClose: _onClose }: { onClose?: () => void } = {}) {
  const provider_next = useAppState((s) => s.provider_next)
  const { bootstrap } = useAppActions()
  const sdk = useSDK()
  const { theme } = useTheme()
  const toast = useToast()
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [selectedOption, setSelectedOption] = useState<DialogSelectOption<string> | undefined>()

  type ViewState =
    | { type: "list" }
    | { type: "method"; providerID: string; methodIndex: number; method: import("@liteai/sdk").ProviderAuthMethod }
    | { type: "api"; providerID: string; title: string }
    | { type: "select-method"; providerID: string; methods: import("@liteai/sdk").ProviderAuthMethod[] }
    | { type: "code"; providerID: string; title: string; index: number; authorization: ProviderAuthAuthorization }
    | { type: "auto"; providerID: string; title: string; index: number; authorization: ProviderAuthAuthorization }
    | { type: "model"; providerID: string }

  const [view, setView] = useState<ViewState>({ type: "list" })

  const connectedSet = useMemo(() => new Set(provider_next?.connected || []), [provider_next?.connected])

  const connectedOptions = useMemo(() => {
    return (provider_next?.all || [])
      .filter((p) => connectedSet.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (p) =>
          ({
            title: p.name,
            value: p.id,
            description: disconnecting === p.id ? "(disconnecting...)" : "✓ connected",
            category: "Connected",
          }) as DialogSelectOption<string>,
      )
  }, [provider_next?.all, connectedSet, disconnecting])

  const availableOptions = useMemo(() => {
    const available = (provider_next?.all || []).filter((p) => !connectedSet.has(p.id))
    const sorted = [...available].sort((a, b) => {
      const pA = PROVIDER_PRIORITY[a.id] ?? 99
      const pB = PROVIDER_PRIORITY[b.id] ?? 99
      if (pA !== pB) return pA - pB
      return a.name.localeCompare(b.name)
    })

    return sorted.map(
      (provider) =>
        ({
          title: provider.name,
          value: provider.id,
          description: (
            {
              "google-code-assist": "(Recommended)",
              anthropic: "(API key)",
              openai: "(ChatGPT Plus/Pro or API key)",
            } as Record<string, string>
          )[provider.id],
          category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
        }) as DialogSelectOption<string>,
    )
  }, [provider_next?.all, connectedSet])

  const allOptions = useMemo(() => [...connectedOptions, ...availableOptions], [connectedOptions, availableOptions])
  const connectOptions = useDialogProviderOptions(setView)

  const disconnect = async (providerID: string, name: string) => {
    if (disconnecting) return
    setDisconnecting(providerID)
    try {
      const { error } = await sdk.client.auth.remove({ providerID })
      if (error) {
        setDisconnecting(null)
        toast.show({ variant: "error", message: `Failed to disconnect ${name}` })
        return
      }
      await sdk.client.project.instance.dispose({ projectID: sdk.projectID })
      await bootstrap()
      toast.show({ variant: "info", message: `Disconnected ${name}` })
    } finally {
      setDisconnecting(null)
    }
  }

  useKeybindings(
    {
      "select:delete": () => {
        if (!selectedOption) return
        if (!connectedSet.has(selectedOption.value)) return
        disconnect(selectedOption.value, selectedOption.title)
      },
    },
    { context: "Select" },
  )

  if (view.type === "method") {
    return <MethodRunner providerID={view.providerID} methodIndex={view.methodIndex} method={view.method} onNavigate={setView} onClose={_onClose} />
  }

  if (view.type === "api") {
    return <ApiMethod providerID={view.providerID} title={view.title} onNavigate={setView} onClose={_onClose} />
  }

  if (view.type === "code") {
    return <CodeMethod providerID={view.providerID} title={view.title} index={view.index} authorization={view.authorization} onNavigate={setView} onClose={_onClose} />
  }

  if (view.type === "auto") {
    return <AutoMethod providerID={view.providerID} title={view.title} index={view.index} authorization={view.authorization} onNavigate={setView} onClose={_onClose} />
  }

  if (view.type === "model") {
    return <DialogModel providerID={view.providerID} onClose={_onClose} />
  }

  if (view.type === "select-method") {
    return (
      <DialogSelect
        title="Select auth method"
        options={view.methods.map((x, index) => ({
          title: x.label,
          value: String(index),
        }))}
        onEscape={() => setView({ type: "list" })}
        onSelect={async (option) => {
          const index = Number.parseInt(option.value, 10)
          const method = view.methods[index]
          if (method.type === "oauth") {
            setView({ type: "method", providerID: view.providerID, methodIndex: index, method })
          } else if (method.type === "api") {
            setView({ type: "api", providerID: view.providerID, title: method.label })
          }
        }}
      />
    )
  }

  return (
    <DialogSelect
      title="Providers"
      options={allOptions}
      onMove={setSelectedOption}
      onEscape={_onClose}
      footerContent={
        connectedOptions.length > 0 ? (
          <Text color={theme.textMuted as Color}>↑↓ navigate · Enter connect · ctrl+d disconnect</Text>
        ) : undefined
      }
      onSelect={(option) => {
        if (connectedSet.has(option.value)) return
        const match = connectOptions.find((o) => o.value === option.value)
        if (match?.onSelect) match.onSelect({} as any)
      }}
    />
  )
}

function AutoMethod({
  index,
  providerID,
  title,
  authorization,
  onNavigate,
  onClose,
}: {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
  onNavigate: (view: any) => void
  onClose?: () => void
}) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const { bootstrap } = useAppActions()

  useEffect(() => {
    let active = true
    sdk.client.provider.oauth
      .callback({
        providerID,
        method: index,
      })
      .then(async (result) => {
        if (!active) return
        if (result.error) {
          onClose?.()
          return
        }
        await sdk.client.project.instance.dispose({ projectID: sdk.projectID })
        await bootstrap()
        onNavigate({ type: "model", providerID })
      })
    return () => {
      active = false
    }
  }, [sdk, providerID, index, onNavigate, onClose, bootstrap])

  return (
    <Box paddingLeft={2} paddingRight={2} flexDirection="column" gap={1} paddingBottom={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={theme.text as Color}>
          {title}
        </Text>
        <Text color={theme.textMuted as Color}>esc</Text>
      </Box>
      <Box flexDirection="column" gap={1}>
        <Text color={theme.primary as Color}>{authorization.url}</Text>
        <Text color={theme.textMuted as Color}>{authorization.instructions}</Text>
      </Box>
      <Text color={theme.textMuted as Color}>Waiting for authorization...</Text>
    </Box>
  )
}

function CodeMethod({
  index,
  title,
  providerID,
  authorization,
  onNavigate,
  onClose,
}: {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
  onNavigate: (view: any) => void
  onClose?: () => void
}) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const { bootstrap } = useAppActions()
  const [error, setError] = useState(false)

  return (
    <DialogPrompt
      title={title}
      placeholder="Enter JSON"
      onCancel={onClose}
      onConfirm={async (value) => {
        const { error: err } = await sdk.client.provider.oauth.callback({
          providerID,
          method: index,
          code: value,
        })
        if (!err) {
          await sdk.client.project.instance.dispose({ projectID: sdk.projectID })
          await bootstrap()
          onNavigate({ type: "model", providerID })
          return
        }
        setError(true)
      }}
      description={
        <Box flexDirection="column" gap={1}>
          <Text color={theme.textMuted as Color}>{authorization.instructions}</Text>
          <Text color={theme.primary as Color}>{authorization.url}</Text>
          {error && <Text color={theme.error as Color}>Invalid code</Text>}
        </Box>
      }
    />
  )
}

function ApiMethod({
  providerID,
  title,
  onNavigate,
  onClose,
}: {
  providerID: string
  title: string
  onNavigate: (view: any) => void
  onClose?: () => void
}) {
  const sdk = useSDK()
  const { bootstrap } = useAppActions()
  const { theme } = useTheme()

  const description = {
    "google-code-assist": (
      <Box flexDirection="column" gap={1}>
        <Text color={theme.textMuted as Color}>
          Google Code Assist gives you free access to Gemini models for coding, powered by your Google account.
        </Text>
        <Text color={theme.text as Color}>
          Sign in at <Text color={theme.primary as Color}>https://idx.google.com</Text> to get a key
        </Text>
      </Box>
    ),
  }[providerID]

  return (
    <DialogPrompt
      title={title}
      placeholder="API key"
      description={description}
      onCancel={onClose}
      onConfirm={async (value) => {
        if (!value) return
        await sdk.client.auth.set({
          providerID,
          auth: {
            type: "api",
            key: value,
          },
        })
        await sdk.client.project.instance.dispose({ projectID: sdk.projectID })
        await bootstrap()
        onNavigate({ type: "model", providerID })
      }}
    />
  )
}
