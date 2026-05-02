import { Box, type Color, Text } from "@liteai/ink"
import { Log } from "@liteai/util/log"
import { useEffect, useMemo, useState } from "react"
import { useDialog } from "../context/dialog"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useKeybindings } from "../keybindings/use-keybinding"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"

function Status(props: { enabled: boolean; loading: boolean; isFailed?: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <Text color={theme.textMuted as Color}>⋯ Loading</Text>
  }
  if (props.isFailed) {
    return (
      <Text color={theme.error as Color} bold>
        ✗ Failed
      </Text>
    )
  }
  if (props.enabled) {
    return (
      <Text color={theme.success as Color} bold>
        ✓ connected
      </Text>
    )
  }
  return <Text color={theme.textMuted as Color}>○ disabled</Text>
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [loading, setLoading] = useState<string | null>(null)
  const [selectedOption, setSelectedOption] = useState<DialogSelectOption<string> | undefined>()

  const options = useMemo(() => {
    const mcpData = sync.mcp
    const mcpEntries = Object.entries(mcpData || {})
    mcpEntries.sort(([nameA], [nameB]) => nameA.localeCompare(nameB))

    return mcpEntries.map(([name, status]) => {
      const isFailed = status.status === "failed"
      let desc = ""
      if (isFailed) {
        desc = "failed to start"
      } else if (status.status === "needs_auth" || status.status === "needs_client_registration") {
        desc = "⚠ needs authentication"
      }

      return {
        value: name,
        title: name,
        description: desc,
        footer: <Status enabled={local.mcp.isEnabled(name)} loading={loading === name} isFailed={isFailed} />,
        category: "User MCPs",
      }
    })
  }, [sync.mcp, local.mcp, loading])

  useKeybindings(
    {
      "select:toggle": async () => {
        if (!selectedOption) return
        if (loading !== null) return
        setLoading(selectedOption.value)
        try {
          await local.mcp.toggle(selectedOption.value)
          await sdk.client.project.mcp.status({ projectID: sdk.projectID })
        } catch (error) {
          Log.Default.error("Failed to toggle MCP:", { error })
        } finally {
          setLoading(null)
        }
      },
    },
    { context: "Select" },
  )

  return (
    <DialogSelect
      title="Manage MCP servers"
      header={<Text color={theme.textMuted as Color}>{Object.keys(sync.mcp ?? {}).length} servers</Text>}
      footerContent={
        <Text color={theme.textMuted as Color}>
          ↑↓ to navigate · Enter to confirm · Space to toggle · Esc to cancel
        </Text>
      }
      options={options}
      onMove={setSelectedOption}
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
  const [loading, setLoading] = useState<string | null>(null)

  const mcpConfig = sync.config?.mcpServers?.[props.name]
  const mcpStatus = sync.mcp?.[props.name]
  const enabled = local.mcp.isEnabled(props.name)
  const [toolsLength, setToolsLength] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    sdk
      .fetch(`${sdk.url}/mcp/tools`)
      .then((r) => r.json())
      .then((data: Record<string, string[]>) => {
        if (!active) return
        const toolNames = data?.[props.name]
        if (toolNames) setToolsLength(toolNames.length)
        else setToolsLength(0)
      })
      .catch((err) => {
        Log.Default.error("tools API Error", { error: err })
      })
    return () => {
      active = false
    }
  }, [sdk, props.name])

  const options = useMemo(
    () => [
      ...(mcpStatus?.status === "needs_auth" || mcpStatus?.status === "needs_client_registration"
        ? [
            {
              value: "authenticate",
              title: "Authenticate",
              disabled: false,
            },
          ]
        : []),
      {
        value: "tools",
        title: "View tools",
        disabled: !enabled,
      },
      {
        value: "reconnect",
        title: "Reconnect",
        disabled: !enabled,
      },
      {
        value: "toggle",
        title: enabled ? "Disable" : "Enable",
      },
    ],
    [enabled, mcpStatus],
  )

  const header = () => {
    const s = mcpStatus
    const c = mcpConfig as { type?: string; command?: string; args?: string[]; url?: string } | undefined
    const isLoading = loading === "toggle" || loading === "reconnect"
    const isFailed = s && s.status === "failed"

    return (
      <Box flexDirection="column">
        <Text>
          <Text color={theme.text as Color} bold>
            Status:{" "}
          </Text>
          <Status enabled={enabled} loading={isLoading} isFailed={isFailed} />
        </Text>

        {/* biome-ignore lint/suspicious/noExplicitAny: API shape not in SDK */}
        {isFailed && (mcpStatus as any)?.error && (
          <Text>
            <Text color={theme.error as Color} bold>
              Error:{" "}
            </Text>
            {/* biome-ignore lint/suspicious/noExplicitAny: API shape not in SDK */}
            <Text color={theme.textMuted as Color}>{(mcpStatus as any).error}</Text>
          </Text>
        )}

        {c && c.type === "local" && (
          <Box flexDirection="column">
            <Text>
              <Text color={theme.text as Color} bold>
                Command:{" "}
              </Text>
              <Text color={theme.textMuted as Color}>{c.command}</Text>
            </Text>
            {(c.args?.length ?? 0) > 0 && (
              <Text>
                <Text color={theme.text as Color} bold>
                  Args:{" "}
                </Text>
                <Text color={theme.textMuted as Color}>{c.args?.join(" ")}</Text>
              </Text>
            )}
          </Box>
        )}

        {c && c.type === "remote" && (
          <Text>
            <Text color={theme.text as Color} bold>
              URL:{" "}
            </Text>
            <Text color={theme.textMuted as Color}>{c.url}</Text>
          </Text>
        )}

        {toolsLength !== null && (
          <Text>
            <Text color={theme.text as Color} bold>
              Tools:{" "}
            </Text>
            <Text color={theme.textMuted as Color}>{toolsLength} tools</Text>
          </Text>
        )}
      </Box>
    )
  }

  return (
    <DialogSelect
      title={`${props.name} MCP Server`}
      skipFilter={true}
      header={header()}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ to navigate · Enter to select</Text>}
      options={options}
      onSelect={async (option) => {
        if (option.value === "authenticate") {
          // biome-ignore lint/suspicious/noExplicitAny: API shape not in SDK
          const authUrl = (mcpStatus as any)?.authUrl
          if (authUrl) {
            const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open"
            const args = process.platform === "win32" ? ["/c", "start", "", authUrl] : [authUrl]
            Bun.spawn([cmd, ...args], { stdout: "ignore", stderr: "ignore" })
          }
        } else if (option.value === "toggle") {
          if (loading !== null) return
          setLoading("toggle")
          try {
            await local.mcp.toggle(props.name)
            await sdk.client.project.mcp.status({ projectID: sdk.projectID })
          } catch (error) {
            Log.Default.error("Failed to toggle MCP", { error })
          } finally {
            setLoading(null)
          }
        } else if (option.value === "reconnect") {
          if (loading !== null) return
          setLoading("reconnect")
          try {
            await sdk.client.project.mcp.disconnect({ projectID: sdk.projectID, name: props.name })
            await sdk.client.project.mcp.connect({ projectID: sdk.projectID, name: props.name })
            await sdk.client.project.mcp.status({ projectID: sdk.projectID })

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
  // biome-ignore lint/suspicious/noExplicitAny: API shape not in SDK
  const [tools, setTools] = useState<any[]>([])

  useEffect(() => {
    let active = true
    sdk
      .fetch(`${sdk.url}/mcp/tools`)
      .then((r) => {
        if (!r.ok) {
          Log.Default.error("tools SDK response not ok", { status: r.status, statusText: r.statusText })
        }
        return r.json()
      })
      // biome-ignore lint/suspicious/noExplicitAny: API shape not in SDK
      .then((data: Record<string, any[]>) => {
        if (!active) return
        const toolNames = data?.[props.name]
        if (toolNames) setTools(toolNames)
      })
      .catch((err) => {
        Log.Default.error("tools list API Error", { error: err })
      })
    return () => {
      active = false
    }
  }, [sdk, props.name])

  useKeybindings(
    {
      "select:cancel": props.onBack,
    },
    { context: "Select" },
  )

  const options = useMemo(() => {
    return tools.map((t) => ({
      title: typeof t === "string" ? t : t.name,
      value: typeof t === "string" ? t : t.name,
      description: typeof t === "string" ? undefined : t.description,
    }))
  }, [tools])

  return (
    <DialogSelect
      title={`${props.name} Tools`}
      options={options}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ to navigate · Esc to back</Text>}
    />
  )
}
