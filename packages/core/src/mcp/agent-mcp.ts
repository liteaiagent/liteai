import type { Agent } from "@/agent/agent"
import { McpConnectionError } from "@/agent/errors"
import { isRestrictedToPluginOnly } from "@/agent/policy"
import type { Config } from "@/config/config"
import { Log } from "@/util/log"
import { MCP } from "./index"

const log = Log.create({ service: "agent:mcp" })

export interface AgentMcpSession {
  clients: Array<{ name: string; client: MCP.MCPClient; config: Config.Mcp }>
  cleanup: () => Promise<void>
}

export async function initializeAgentMcpServers(agentDef: Agent.AgentDefinition): Promise<AgentMcpSession> {
  if (!agentDef.mcpServers || agentDef.mcpServers.length === 0) {
    return { clients: [], cleanup: async () => {} }
  }

  const isRestricted = isRestrictedToPluginOnly("mcp", agentDef)
  let mcpServerSpecs = agentDef.mcpServers

  if (isRestricted) {
    const hasInlineServer = mcpServerSpecs.some((s) => typeof s === "object")
    if (hasInlineServer) {
      log.warn("Skipping inline MCP servers: restricted to plugin-only", { agentId: agentDef.name })
      mcpServerSpecs = mcpServerSpecs.filter((s) => typeof s === "string")
    }
  }

  const newlyCreatedClients: MCP.MCPClient[] = []
  const clients: Array<{ name: string; client: MCP.MCPClient; config: Config.Mcp }> = []

  const cleanup = async () => {
    for (const c of newlyCreatedClients) {
      try {
        await c.close()
      } catch (e) {
        log.warn("Error cleaning up inline MCP server", { error: String(e) })
      }
    }
  }

  try {
    for (const spec of mcpServerSpecs) {
      if (typeof spec === "string") {
        // String logic: resolve against project-wide config via getMcpConfigByName
        const config = await MCP.getMcpConfigByName(spec)
        if (!config) {
          log.warn(`MCP server not found: ${spec}`)
          throw new McpConnectionError(`MCP server not found: ${spec}`)
        }

        await MCP.ensureConnected(spec)
        const s = await MCP.state()

        if (s.status[spec]?.status !== "connected" || !s.clients[spec]) {
          throw new McpConnectionError(`Failed to connect to required MCP server: ${spec}`)
        }

        // We DO NOT push to newlyCreatedClients because this is a shared lifecycle
        clients.push({ name: spec, client: s.clients[spec], config })
      } else {
        const keys = Object.keys(spec)
        if (keys.length !== 1) {
          log.warn("Invalid MCP server spec: expected exactly one key mapping a serverName to its McpConfig", {
            expected: '{ "<serverName>": McpConfig }',
            spec,
          })
          continue
        }
        const serverName = keys[0]
        const serverConfig = spec[serverName]

        // MCP.create bypasses global registry adding
        const result = await MCP.create(serverName, serverConfig as Config.Mcp)
        if (result.status.status !== "connected" || !result.mcpClient) {
          throw new McpConnectionError(
            `Failed to connect to inline MCP server '${serverName}': ${result.status.status}`,
          )
        }

        newlyCreatedClients.push(result.mcpClient)
        clients.push({ name: serverName, client: result.mcpClient, config: serverConfig as Config.Mcp })
      }
    }

    return { clients, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
