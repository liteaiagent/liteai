import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useLocal } from "@tui/context/local"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "@tui/ui/dialog-select"
import { entries, map, pipe, sortBy } from "remeda"
import { createMemo, createSignal, onMount } from "solid-js"
import { Keybind } from "@/util/keybind"
import { Log } from "@/util/log"
import { useTheme } from "../context/theme"

function Status(props: { enabled: boolean; loading: boolean; isFailed?: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.isFailed) {
    return <span style={{ fg: theme.error, attributes: TextAttributes.BOLD }}>✗ Failed</span>
  }
  if (props.enabled) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ connected</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ disabled</span>
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)

  const options = createMemo(() => {
    const mcpData = sync.data.mcp
    const loadingMcp = loading()

    return pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => {
        const title = name
        const category = "User MCPs"

        let desc = ""
        const isFailed = status.status === "failed"

        if (isFailed) {
          desc = "failed to start"
        } else if (status.status === "needs_auth" || status.status === "needs_client_registration") {
          desc = "⚠ needs authentication"
        }

        return {
          value: name,
          title: title,
          description: desc,
          footer: <Status enabled={local.mcp.isEnabled(name)} loading={loadingMcp === name} isFailed={isFailed} />,
          category: category,
        }
      }),
    )
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null) return
        setLoading(option.value)
        try {
          await local.mcp.toggle(option.value)
          const status = await sdk.client.project.mcp.status({ projectID: sdk.projectID })
          if (status.data) {
            sync.set("mcp", status.data)
          }
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="Manage MCP servers"
      header={<text fg={useTheme().theme.textMuted}>{Object.keys(sync.data.mcp ?? {}).length} servers</text>}
      footerContent={<text fg={useTheme().theme.textMuted}>↑↓ to navigate · Enter to confirm · Esc to cancel</text>}
      options={options()}
      keybind={keybinds()}
      onSelect={(option) => {
        dialog.push(() => <McpDetail name={option.value} />)
      }}
    />
  )
}

function McpDetail(props: { name: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const local = useLocal()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [loading, setLoading] = createSignal<string | null>(null)

  const mcpConfig = createMemo(() => sync.data.config?.mcp?.[props.name])
  const mcpStatus = createMemo(() => sync.data.mcp?.[props.name])
  const enabled = createMemo(() => local.mcp.isEnabled(props.name))
  const [toolsLength, setToolsLength] = createSignal<number | null>(null)

  onMount(() => {
    sdk
      .fetch(`${sdk.url}/mcp/tools`)
      .then((r) => r.json())
      .then((data: Record<string, string[]>) => {
        const toolNames = data?.[props.name]
        if (toolNames) setToolsLength(toolNames.length)
        else setToolsLength(0)
      })
      .catch((err) => {
        Log.Default.error("tools API Error", { error: err })
      })
  })

  const options = createMemo(() => {
    return [
      {
        value: "tools",
        title: "View tools",
        disabled: !enabled(),
      },
      {
        value: "reconnect",
        title: "Reconnect",
        disabled: !enabled(),
      },
      {
        value: "toggle",
        title: enabled() ? "Disable" : "Enable",
      },
    ]
  })

  const header = () => {
    const s = mcpStatus()
    const c = mcpConfig() as { type?: string; command?: string[]; url?: string } | undefined
    const isLoading = loading() === "toggle" || loading() === "reconnect"
    const isFailed = s && s.status === "failed"

    return (
      <box gap={0} flexDirection="column">
        <text>
          <span style={{ fg: theme.text, attributes: TextAttributes.BOLD }}>Status: </span>
          <Status enabled={enabled()} loading={isLoading} isFailed={isFailed} />
        </text>

        {c && c.type === "local" && (
          <>
            <text>
              <span style={{ fg: theme.text, attributes: TextAttributes.BOLD }}>Command: </span>
              <span style={{ fg: theme.textMuted }}>{c.command?.[0]}</span>
            </text>
            {(c.command?.length ?? 0) > 1 && (
              <text>
                <span style={{ fg: theme.text, attributes: TextAttributes.BOLD }}>Args: </span>
                <span style={{ fg: theme.textMuted }}>{c.command?.slice(1).join(" ")}</span>
              </text>
            )}
          </>
        )}

        {c && c.type === "remote" && (
          <text>
            <span style={{ fg: theme.text, attributes: TextAttributes.BOLD }}>URL: </span>
            <span style={{ fg: theme.textMuted }}>{c.url}</span>
          </text>
        )}

        {toolsLength() !== null && (
          <text>
            <span style={{ fg: theme.text, attributes: TextAttributes.BOLD }}>Tools: </span>
            <span style={{ fg: theme.textMuted }}>{toolsLength()} tools</span>
          </text>
        )}
      </box>
    )
  }

  return (
    <DialogSelect
      title={`${props.name} MCP Server`}
      skipFilter={true}
      header={header()}
      footerContent={<text fg={theme.textMuted}>↑↓ to navigate · Enter to select</text>}
      options={options()}
      keybind={[]}
      onSelect={async (option) => {
        if (option.value === "toggle") {
          if (loading() !== null) return
          setLoading("toggle")
          try {
            await local.mcp.toggle(props.name)
            const status = await sdk.client.project.mcp.status({ projectID: sdk.projectID })
            if (status.data) sync.set("mcp", status.data)
          } catch (error) {
            Log.Default.error("Failed to toggle MCP", { error })
          } finally {
            setLoading(null)
          }
        } else if (option.value === "reconnect") {
          if (loading() !== null) return
          setLoading("reconnect")
          try {
            await sdk.client.project.mcp.disconnect({ projectID: sdk.projectID, name: props.name })
            await sdk.client.project.mcp.connect({ projectID: sdk.projectID, name: props.name })
            const status = await sdk.client.project.mcp.status({ projectID: sdk.projectID })
            if (status.data) sync.set("mcp", status.data)

            // refresh tools length
            sdk
              .fetch(`${sdk.url}/mcp/tools`)
              .then((r) => r.json())
              .then((data: Record<string, string[]>) => {
                const toolNames = data?.[props.name]
                if (toolNames) setToolsLength(toolNames.length)
                else setToolsLength(0)
              })
              .catch((err) => {
                Log.Default.error("tools reconnect API Error", { error: err })
              })
          } catch (error) {
            Log.Default.error("Failed to reconnect MCP", { error })
          } finally {
            setLoading(null)
          }
        } else if (option.value === "tools") {
          dialog.push(() => <McpToolsList name={props.name} onBack={() => dialog.pop()} />)
        }
      }}
    />
  )
}

function McpToolsList(props: { name: string; onBack: () => void }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const [tools, setTools] = createSignal<string[]>([])

  onMount(() => {
    sdk
      .fetch(`${sdk.url}/mcp/tools`)
      .then((r) => {
        if (!r.ok) {
          Log.Default.error("tools SDK response not ok", { status: r.status, statusText: r.statusText })
        }
        return r.json()
      })
      .then((data: Record<string, string[]>) => {
        const toolNames = data?.[props.name]
        if (toolNames) setTools(toolNames)
      })
      .catch((err) => {
        Log.Default.error("tools list API Error", { error: err })
      })
  })

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      props.onBack()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  const options = createMemo(() => {
    return tools().map((t) => ({
      title: t,
      value: t,
    }))
  })

  return (
    <DialogSelect
      title={`${props.name} Tools`}
      options={options()}
      footerContent={<text fg={theme.textMuted}>↑↓ to navigate · Esc to back</text>}
      keybind={[]}
    />
  )
}
