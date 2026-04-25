/** @jsxImportSource react */
import { Log } from "@liteai/core/util/log"
import { Box, type Color, Text, useInput } from "@liteai/ink"
import { useEffect, useMemo, useState } from "react"
import { useDialog } from "../context/dialog"
import { useKeybind } from "../context/keybind"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
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
  const keybind = useKeybind()
  const [loading, setLoading] = useState<string | null>(null)

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

  const keybinds = useMemo(
    () => [
      {
        keybind: keybind.all.space?.[0] || "space",
        title: "toggle",
        onTrigger: async (option: DialogSelectOption<string>) => {
          if (loading !== null) return
          setLoading(option.value)
          try {
            await local.mcp.toggle(option.value)
            await sdk.client.project.mcp.status({ projectID: sdk.projectID })
          } catch (error) {
            Log.Default.error("Failed to toggle MCP:", { error })
          } finally {
            setLoading(null)
          }
        },
      },
    ],
    [keybind.all.space, loading, local.mcp, sdk],
  )

  return (
    <DialogSelect
      title="Manage MCP servers"
      header={<Text color={theme.textMuted as Color}>{Object.keys(sync.mcp ?? {}).length} servers</Text>}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ to navigate · Enter to confirm · Esc to cancel</Text>}
      options={options}
      keybind={keybinds}
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
    [enabled],
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
      keybind={[]}
      onSelect={async (option) => {
        if (option.value === "toggle") {
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
  const [tools, setTools] = useState<string[]>([])

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
      .then((data: Record<string, string[]>) => {
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

  useInput((_char, _key, event) => {
    if (event?.keypress?.name === "escape") {
      props.onBack()
    }
  })

  const options = useMemo(() => {
    return tools.map((t) => ({
      title: t,
      value: t,
    }))
  }, [tools])

  return (
    <DialogSelect
      title={`${props.name} Tools`}
      options={options}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ to navigate · Esc to back</Text>}
      keybind={[]}
    />
  )
}
