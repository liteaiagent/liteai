import { execSync } from "node:child_process"
// biome-ignore lint/style/noRestrictedImports: dialog-provider is an exception — uses useInput directly
import { Box, type Color, type InputEvent, type Key, Text, useInput } from "@liteai/ink"
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@liteai/sdk"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { openUrlInBrowser } from "../../utils/browser"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useKeybindings } from "../keybindings/use-keybinding"
import type { SelectItem } from "../primitives/types"
import { useDialogLifecycle } from "../primitives/use-dialog-lifecycle"
import { useAppActions, useAppState } from "../state"
import { DialogPrompt } from "../ui/dialog-prompt"
import { SelectPane } from "../ui/select-pane"
import { DialogModel } from "./dialog-model"
import { TextInput } from "./text-input"

/** Discriminated union describing the active sub-view within the provider dialog. */
export type ProviderViewState =
  | { type: "list" }
  | { type: "method"; providerID: string; methodIndex: number; method: ProviderAuthMethod }
  | { type: "api"; providerID: string; title: string }
  | { type: "select-method"; providerID: string; methods: ProviderAuthMethod[] }
  | { type: "code"; providerID: string; title: string; index: number; authorization: ProviderAuthAuthorization }
  | { type: "auto"; providerID: string; title: string; index: number; authorization: ProviderAuthAuthorization }
  | { type: "model"; providerID: string }

const PROVIDER_PRIORITY: Record<string, number> = {
  "google-code-assist": 0,
  ai4all: 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

/** Returns a sorted list of provider display options (title, value, description, category). */
export function useProviderDisplayOptions() {
  const provider_next = useAppState((s) => s.provider_next)

  return useMemo(() => {
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
          key: provider.id,
          label: provider.name,
          value: provider.id,
          description: (
            {
              "google-code-assist": "(Recommended)",
              anthropic: "(API key)",
              openai: "(ChatGPT Plus/Pro or API key)",
            } as Record<string, string>
          )[provider.id],
          category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
        }) as SelectItem<string>,
    )
  }, [provider_next?.all])
}

/**
 * Returns a `connect` function that initiates the auth flow for a given provider.
 * Resolves the correct auth method(s) and navigates to the appropriate view.
 */
export function useProviderConnect(onNavigate: (view: ProviderViewState) => void) {
  const provider_auth = useAppState((s) => s.provider_auth)

  return useCallback(
    (providerID: string) => {
      const methods = provider_auth?.[providerID] ?? [{ type: "api" as const, label: "API key" }]

      if (methods.length === 1) {
        const method = methods[0]
        if (method.type === "api") {
          onNavigate({ type: "api", providerID, title: method.label })
          return
        }
      }

      onNavigate({ type: "select-method", providerID, methods: methods as ProviderAuthMethod[] })
    },
    [provider_auth, onNavigate],
  )
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
  onNavigate: (view: ProviderViewState) => void
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
      <SelectPane
        title={prompt.message}
        items={prompt.options.map((o: { label: string; value: string; hint?: string }) => ({
          key: o.value,
          label: o.label,
          value: o.value,
          description: o.hint,
        }))}
        onClose={onClose}
        onSelect={(item) => {
          setInputs((prev) => ({ ...prev, [prompt.key]: item.value }))
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

export function DialogProvider({ onClose: _onClose = () => {} }: { onClose?: () => void }) {
  const provider_next = useAppState((s) => s.provider_next)
  const { bootstrap } = useAppActions()
  const sdk = useSDK()
  const { theme } = useTheme()
  const toast = useToast()
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [selectedOption, setSelectedOption] = useState<SelectItem<string> | undefined>()

  const [view, setView] = useState<ProviderViewState>({ type: "list" })

  const connectedSet = useMemo(() => new Set(provider_next?.connected || []), [provider_next?.connected])

  const connectedOptions = useMemo(() => {
    return (provider_next?.all || [])
      .filter((p) => connectedSet.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (p) =>
          ({
            key: p.id,
            label: p.name,
            value: p.id,
            description: disconnecting === p.id ? "(disconnecting...)" : "✓ connected",
            category: "Connected",
          }) as SelectItem<string>,
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
          key: provider.id,
          label: provider.name,
          value: provider.id,
          description: (
            {
              "google-code-assist": "(Recommended)",
              anthropic: "(API key)",
              openai: "(ChatGPT Plus/Pro or API key)",
            } as Record<string, string>
          )[provider.id],
          category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
        }) as SelectItem<string>,
    )
  }, [provider_next?.all, connectedSet])

  const allOptions = useMemo(() => [...connectedOptions, ...availableOptions], [connectedOptions, availableOptions])
  const connectProvider = useProviderConnect(setView)

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
        disconnect(selectedOption.value, selectedOption.label)
      },
    },
    { context: "Select" },
  )

  if (view.type === "method") {
    return (
      <MethodRunner
        providerID={view.providerID}
        methodIndex={view.methodIndex}
        method={view.method}
        onNavigate={setView}
        onClose={_onClose}
      />
    )
  }

  if (view.type === "api") {
    return <ApiMethod providerID={view.providerID} title={view.title} onNavigate={setView} onClose={_onClose} />
  }

  if (view.type === "code") {
    return (
      <CodeMethod
        providerID={view.providerID}
        title={view.title}
        index={view.index}
        authorization={view.authorization}
        onNavigate={setView}
        onClose={_onClose}
      />
    )
  }

  if (view.type === "auto") {
    return (
      <AutoMethod
        providerID={view.providerID}
        title={view.title}
        index={view.index}
        authorization={view.authorization}
        onNavigate={setView}
        onClose={_onClose}
      />
    )
  }

  if (view.type === "model") {
    return <DialogModel providerID={view.providerID} onClose={_onClose} />
  }

  if (view.type === "select-method") {
    return (
      <SelectPane
        title="Select auth method"
        items={view.methods.map((x, index) => ({
          key: String(index),
          label: x.label,
          value: String(index),
        }))}
        onClose={() => setView({ type: "list" })}
        onSelect={(item) => {
          const index = Number.parseInt(item.value, 10)
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
    <SelectPane
      title="Providers"
      items={allOptions}
      onHighlight={setSelectedOption}
      onClose={_onClose}
      footerContent={
        connectedOptions.length > 0 ? (
          <Text color={theme.textMuted as Color}>↑↓ navigate · Enter connect · ctrl+d disconnect</Text>
        ) : undefined
      }
      onSelect={(item) => {
        if (connectedSet.has(item.value)) return
        connectProvider(item.value)
      }}
    />
  )
}

// ── Static helpers (no React hooks — safe to call from any context) ──────────

/** Circuit-breaker: hard-caps browser launches per process to prevent runaway loops. */
let _browserLaunchCount = 0
const BROWSER_LAUNCH_MAX = 3

function openBrowser(url: string) {
  if (_browserLaunchCount >= BROWSER_LAUNCH_MAX) return
  _browserLaunchCount++
  openUrlInBrowser(url)
}

/**
 * Write text to the system clipboard using platform-native commands.
 * Intentionally NOT a React hook — uses execSync directly to avoid
 * render-loop hazards that caused the useClipboard infinite-loop incident.
 */
function copyToClipboard(text: string) {
  try {
    if (process.platform === "win32") {
      execSync("clip.exe", { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 3000 })
    } else if (process.platform === "darwin") {
      execSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 3000 })
    } else {
      execSync("xclip -selection clipboard", { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 3000 })
    }
  } catch {
    // Clipboard copy is best-effort; URL is displayed for manual selection
  }
}

/**
 * Shared URL display for OAuth auth screens.
 * Renders: title bar → instructions → URL at column 0 → clipboard hint.
 * URL is deliberately rendered without padding or borders so that
 * terminal text selection never picks up stray characters.
 *
 * Ctrl+C re-copies the URL to clipboard (since TUI line padding makes
 * manual text selection unreliable for wrapped URLs).
 */
function AuthUrlHeader({
  title,
  url,
  instructions,
  onClose,
}: {
  title: string
  url: string
  instructions?: string
  onClose?: () => void
}) {
  const { theme } = useTheme()
  const toast = useToast()

  useDialogLifecycle({
    contextName: "Select",
    onClose: () => onClose?.(),
  })

  // Copy URL to clipboard exactly once on mount (static function — no React loop risk)
  const copiedRef = useRef(false)
  useEffect(() => {
    if (url && !copiedRef.current) {
      copiedRef.current = true
      copyToClipboard(url)
    }
  }, [url])

  // Ctrl+C re-copies the URL to clipboard on demand
  useInput((_input: string, key: Key, event: InputEvent) => {
    if (key.ctrl && _input === "c") {
      copyToClipboard(url)
      toast.show({ variant: "success", message: "URL copied to clipboard" })
      event.stopImmediatePropagation()
    }
  })

  return (
    <>
      <Box paddingLeft={2} paddingRight={2} flexDirection="row" justifyContent="space-between">
        <Text bold color={theme.text as Color}>
          {title}
        </Text>
        <Text color={theme.textMuted as Color}>esc</Text>
      </Box>
      {instructions && (
        <Box paddingLeft={2}>
          <Text color={theme.textMuted as Color}>{instructions}</Text>
        </Box>
      )}
      {/* URL at column 0 — no padding, no borders — so terminal selection stays clean */}
      <Text color={theme.primary as Color}>{url}</Text>
      <Box paddingLeft={2}>
        <Text color={theme.textMuted as Color}>💡 URL copied to clipboard. Press Ctrl+C to copy again.</Text>
      </Box>
    </>
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
  onNavigate: (view: ProviderViewState) => void
  onClose?: () => void
}) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const { bootstrap } = useAppActions()

  // Auto-open browser exactly once on mount.
  // Ref guard prevents re-fires; openBrowser has its own circuit-breaker.
  const launchedRef = useRef(false)
  useEffect(() => {
    if (authorization.url && !launchedRef.current) {
      launchedRef.current = true
      openBrowser(authorization.url)
    }
  }, [authorization.url])

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
    <Box flexDirection="column" gap={1} paddingBottom={1}>
      <AuthUrlHeader
        title={title}
        url={authorization.url}
        instructions="Attempting to open authentication page in your browser. Otherwise navigate to:"
        onClose={onClose}
      />
      <Box paddingLeft={2}>
        <Text color={theme.textMuted as Color}>Waiting for authorization...</Text>
      </Box>
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
  onNavigate: (view: ProviderViewState) => void
  onClose?: () => void
}) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const { bootstrap } = useAppActions()
  const [input, setInput] = useState("")
  const [error, setError] = useState(false)

  const onSubmit = useCallback(
    async (value: string) => {
      try {
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
      } catch (err) {
        console.error(err)
        setError(true)
      }
    },
    [sdk, providerID, index, bootstrap, onNavigate],
  )

  return (
    <Box flexDirection="column" gap={1} paddingBottom={1}>
      <AuthUrlHeader
        title={title}
        url={authorization.url}
        instructions={authorization.instructions}
        onClose={onClose}
      />
      <Box paddingLeft={2} flexDirection="column" gap={1}>
        {error && <Text color={theme.error as Color}>Invalid code</Text>}
        <Box borderStyle="round" paddingX={1} borderColor="ansi:blue" width="100%">
          <TextInput
            value={input}
            onChange={setInput}
            placeholder="Enter JSON"
            onSubmit={(val: string) => void onSubmit(val)}
            focus={true}
            disableEscapeDoublePress={true}
          />
        </Box>
      </Box>
    </Box>
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
  onNavigate: (view: ProviderViewState) => void
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
