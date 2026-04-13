import { spawnSync } from "node:child_process"
import { NamedError } from "@liteai/util/error"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { dynamicTool, type JSONSchema7, jsonSchema, type Tool } from "ai"
import open from "open"
import z from "zod/v4"
import { Bus } from "@/bus"
import * as Platform from "@/platform"
import { withTimeout } from "@/util/timeout"
import { BusEvent } from "../bus/bus-event"
import { Config } from "../config/config"
import { Global } from "../global"
import { Installation } from "../installation"
import { Instance } from "../project/instance"
import { expandDeep } from "../util/env-expand"
import { Log } from "../util/log"
import { McpAuth } from "./auth"
import { McpOAuthCallback } from "./oauth-callback"
import { McpOAuthProvider } from "./oauth-provider"

export namespace MCP {
  const log = Log.create({ service: "mcp" })
  const DEFAULT_TIMEOUT = 30_000

  // Track all MCP child process PIDs for forced cleanup on exit
  const pids = new Set<number>()

  process.on("exit", () => {
    for (const pid of pids) {
      try {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], {
            stdio: "ignore",
            windowsHide: true,
          })
        } else {
          process.kill(pid, "SIGKILL")
        }
      } catch (e) {
        log.debug("failed to kill mcp child", { pid, error: e })
      }
    }
    pids.clear()
  })

  export const Resource = z
    .object({
      name: z.string(),
      uri: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
      client: z.string(),
    })
    .meta({ ref: "McpResource" })
  export type Resource = z.infer<typeof Resource>

  export const ToolsChanged = BusEvent.define(
    "mcp.tools.changed",
    z.object({
      server: z.string(),
    }),
  )

  export const BrowserOpenFailed = BusEvent.define(
    "mcp.browser.open.failed",
    z.object({
      mcpName: z.string(),
      url: z.string(),
    }),
  )

  export const AuthRequired = BusEvent.define(
    "mcp.auth.required",
    z.object({
      server: z.string(),
      message: z.string(),
      variant: z.enum(["needs_auth", "needs_client_registration"]),
    }),
  )

  export const Failed = NamedError.create(
    "MCPFailed",
    z.object({
      name: z.string(),
    }),
  )

  export type MCPClient = Client

  export const Status = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("connected"),
        })
        .meta({
          ref: "MCPStatusConnected",
        }),
      z
        .object({
          status: z.literal("disabled"),
        })
        .meta({
          ref: "MCPStatusDisabled",
        }),
      z
        .object({
          status: z.literal("failed"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusFailed",
        }),
      z
        .object({
          status: z.literal("needs_auth"),
        })
        .meta({
          ref: "MCPStatusNeedsAuth",
        }),
      z
        .object({
          status: z.literal("needs_client_registration"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusNeedsClientRegistration",
        }),
    ])
    .meta({
      ref: "MCPStatus",
    })
  export type Status = z.infer<typeof Status>

  // Register notification handlers for MCP client
  function registerNotificationHandlers(client: MCPClient, serverName: string) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      log.info("tools list changed notification received", { server: serverName })
      Bus.publish(ToolsChanged, { server: serverName })
    })
  }

  // Convert MCP tool definition to AI SDK Tool type
  export async function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Promise<Tool> {
    const inputSchema = mcpTool.inputSchema

    // Spread first, then override type to ensure it's always "object"
    const schema: JSONSchema7 = {
      ...(inputSchema as JSONSchema7),
      type: "object",
      properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
      additionalProperties: false,
    }

    return dynamicTool({
      description: mcpTool.description ?? "",
      inputSchema: jsonSchema(schema),
      execute: async (args: unknown) => {
        return client.callTool(
          {
            name: mcpTool.name,
            arguments: (args || {}) as Record<string, unknown>,
          },
          CallToolResultSchema,
          {
            resetTimeoutOnProgress: true,
            timeout,
          },
        )
      },
    })
  }

  // Store transports for OAuth servers to allow finishing auth
  type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
  const pendingOAuthTransports = new Map<string, TransportWithAuth>()

  // Prompt cache types
  type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]

  type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
  type McpEntry = NonNullable<Config.Info["mcpServers"]>[string]
  function isMcpConfigured(entry: McpEntry): entry is Config.Mcp {
    return typeof entry === "object" && entry !== null && "type" in entry
  }

  // MCP state is process-global — connections are shared across all workspaces.
  // Previously keyed per Instance.directory, which spawned duplicate processes
  // for every open project.
  type McpState = { status: Record<string, Status>; clients: Record<string, MCPClient> }
  let cached: Promise<McpState> | undefined

  async function init(): Promise<McpState> {
    const cfg = await Config.getGlobal()
    const config = { ...(cfg.mcpServers ?? {}) }

    const profile = Platform.active()
    if (profile?.mcpJson) {
      const { loadFile } = await import("./loader")
      const path = await import("node:path")
      const p = path.join(Global.Path.config, ".mcp.json")
      const globalMcpJson = await loadFile(p).catch(() => ({}))
      if (Object.keys(globalMcpJson).length > 0) {
        Object.assign(config, globalMcpJson)
      }
    }
    const names = Object.keys(config)
    log.info("scanning for mcp servers", { count: names.length, servers: names })
    const clients: Record<string, MCPClient> = {}
    const status: Record<string, Status> = {}

    await Promise.all(
      Object.entries(config).map(async ([key, mcp]) => {
        if (!isMcpConfigured(mcp)) {
          log.error("Ignoring MCP config entry without type", { key })
          return
        }

        // If disabled by config, mark as disabled without trying to connect
        if (mcp.disabled === true) {
          log.info("mcp server disabled by config", { name: key })
          status[key] = { status: "disabled" }
          return
        }

        log.info("connecting mcp server", { name: key, type: mcp.type })
        const result = await create(key, mcp).catch((e) => {
          log.error("mcp server create failed", { key, error: e })
          return undefined
        })
        if (!result) return

        status[key] = result.status

        if (result.mcpClient) {
          clients[key] = result.mcpClient
        }
      }),
    )
    return { status, clients }
  }

  export function state() {
    if (!cached) cached = init()
    return cached
  }

  /**
   * Sync project-scoped MCP servers into the global pool.
   * Called during project bootstrap — connects any servers from the project's
   * config (e.g. .mcp.json) that aren't already tracked globally.
   */
  export async function sync() {
    const s = await state()
    const cfg = await Config.get()
    const config = { ...(cfg.mcpServers ?? {}) }

    const { Flag } = await import("@/flag/flag")
    const profile = Platform.active()
    if (!Flag.LITEAI_DISABLE_PROJECT_CONFIG && profile?.mcpJson) {
      const { load } = await import("./loader")
      const mcpJson = await load(Instance.directory, Instance.worktree)
      if (Object.keys(mcpJson).length > 0) {
        Object.assign(config, mcpJson)
      }
    }

    await Promise.all(
      Object.entries(config).map(async ([key, mcp]) => {
        if (key in s.status) return
        if (!isMcpConfigured(mcp)) return

        if (mcp.disabled === true) {
          s.status[key] = { status: "disabled" }
          return
        }

        log.info("connecting project mcp server", { name: key, type: mcp.type })
        const result = await create(key, mcp).catch((e) => {
          log.error("mcp server create failed", { key, error: e })
          return undefined
        })
        if (!result) return

        s.status[key] = result.status
        if (result.mcpClient) s.clients[key] = result.mcpClient
      }),
    )
  }

  // Helper function to fetch prompts for a specific client
  async function fetchPromptsForClient(clientName: string, client: Client) {
    if (!client.getServerCapabilities()?.prompts) return

    const prompts = await client.listPrompts().catch((e) => {
      log.error("failed to get prompts", { clientName, error: e.message })
      return undefined
    })

    if (!prompts) return

    const commands: Record<string, PromptInfo & { client: string }> = {}

    for (const prompt of prompts.prompts) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedPromptName = prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      const key = `${sanitizedClientName}:${sanitizedPromptName}`

      commands[key] = { ...prompt, client: clientName }
    }
    return commands
  }

  async function fetchResourcesForClient(clientName: string, client: Client) {
    if (!client.getServerCapabilities()?.resources) return

    const resources = await client.listResources().catch((e) => {
      log.error("failed to get resources", { clientName, error: e.message })
      return undefined
    })

    if (!resources) return

    const commands: Record<string, ResourceInfo & { client: string }> = {}

    for (const resource of resources.resources) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedResourceName = resource.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      const key = `${sanitizedClientName}:${sanitizedResourceName}`

      commands[key] = { ...resource, client: clientName }
    }
    return commands
  }

  export async function add(name: string, mcp: Config.Mcp) {
    const s = await state()
    const result = await create(name, mcp)
    if (!result) {
      const status = {
        status: "failed" as const,
        error: "unknown error",
      }
      s.status[name] = status
      return {
        status,
      }
    }
    if (!result.mcpClient) {
      s.status[name] = result.status
      return {
        status: s.status,
      }
    }
    // Close existing client if present to prevent memory leaks
    const existingClient = s.clients[name]
    if (existingClient) {
      await existingClient.close().catch((error) => {
        log.error("Failed to close existing MCP client", { name, error })
      })
    }
    s.clients[name] = result.mcpClient
    s.status[name] = result.status

    await Config.update({ mcpServers: { [name]: mcp } }).catch((error) => {
      log.error("Failed to persist MCP config", { name, error })
    })

    return {
      status: s.status,
    }
  }

  export async function create(key: string, raw: Config.Mcp) {
    // Expand ${VAR} and ${VAR:-default} patterns in all config string values
    const mcp = expandDeep(raw)

    if (mcp.disabled === true) {
      log.info("mcp server disabled", { key })
      return {
        mcpClient: undefined,
        status: { status: "disabled" as const },
      }
    }

    log.info("found", { key, type: mcp.type })
    let mcpClient: MCPClient | undefined
    let status: Status | undefined

    if (mcp.type === "remote") {
      // OAuth is enabled by default for remote servers unless explicitly disabled with oauth: false
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      let authProvider: McpOAuthProvider | undefined

      if (!oauthDisabled) {
        authProvider = new McpOAuthProvider(
          key,
          mcp.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
          },
          {
            onRedirect: async (url) => {
              log.info("oauth redirect requested", { key, url: url.toString() })
              // Store the URL - actual browser opening is handled by startAuth
            },
          },
        )
      }

      const transports: Array<{ name: string; transport: TransportWithAuth }> = [
        {
          name: "StreamableHTTP",
          transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
        {
          name: "SSE",
          transport: new SSEClientTransport(new URL(mcp.url), {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
      ]

      let lastError: Error | undefined
      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      for (const { name, transport } of transports) {
        try {
          const client = new Client({
            name: "liteai",
            version: Installation.VERSION,
          })
          await withTimeout(client.connect(transport), connectTimeout)
          registerNotificationHandlers(client, key)
          mcpClient = client
          log.info("connected", { key, transport: name })
          status = { status: "connected" }
          break
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))

          // Handle OAuth-specific errors.
          // The SDK throws UnauthorizedError when auth() returns 'REDIRECT',
          // but may also throw plain Errors when auth() fails internally
          // (e.g. during discovery, registration, or state generation).
          // When an authProvider is attached, treat both cases as auth-related.
          const isAuthError =
            error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))
          if (isAuthError) {
            log.info("mcp server requires authentication", { key, transport: name })

            // Check if this is a "needs registration" error
            if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
              status = {
                status: "needs_client_registration" as const,
                error: "Server does not support dynamic client registration. Please provide clientId in config.",
              }
              Bus.publish(AuthRequired, {
                server: key,
                message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                variant: "needs_client_registration",
              }).catch((e) => log.debug("failed to publish auth event", { error: e }))
            } else {
              // Store transport for later finishAuth call
              pendingOAuthTransports.set(key, transport)
              status = { status: "needs_auth" as const }
              Bus.publish(AuthRequired, {
                server: key,
                message: `Server "${key}" requires authentication. Run: liteai mcp auth ${key}`,
                variant: "needs_auth",
              }).catch((e) => log.debug("failed to publish auth event", { error: e }))
            }
            break
          }

          log.debug("transport connection failed", {
            key,
            transport: name,
            url: mcp.url,
            error: lastError.message,
          })
          status = {
            status: "failed" as const,
            error: lastError.message,
          }
        }
      }
    }

    if (mcp.type === "local") {
      const cmd = mcp.command
      const args = mcp.args ?? []
      const cwd = Global.Path.home
      const env = {
        ...process.env,
        ...(cmd === "liteai" ? { BUN_BE_BUN: "1" } : {}),
        ...mcp.env,
      }
      log.info("spawning local mcp process", {
        key,
        cmd,
        args,
        cwd,
        extraEnvKeys: Object.keys(mcp.env ?? {}),
      })
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env,
      })
      transport.stderr?.on("data", (chunk: Buffer) => {
        log.info(`mcp stderr: ${chunk.toString()}`, { key })
      })

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      try {
        const client = new Client({
          name: "liteai",
          version: Installation.VERSION,
        })
        log.info("connecting local mcp (waiting for ready)", { key, timeout: connectTimeout })
        await withTimeout(client.connect(transport), connectTimeout)
        const pid = (transport as StdioClientTransport).pid
        log.info("local mcp process connected", { key, pid })
        registerNotificationHandlers(client, key)
        mcpClient = client
        status = {
          status: "connected",
        }
      } catch (error) {
        const pid = (transport as StdioClientTransport).pid
        const msg = error instanceof Error ? error.message : String(error)
        log.error("local mcp startup failed", {
          key,
          command: mcp.command,
          cwd,
          pid,
          phase: "connect",
          error: msg,
        })
        // Kill the orphaned process so it does not block future scans
        if (typeof pid === "number") {
          try {
            if (process.platform === "win32") {
              spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore", windowsHide: true })
              log.info("killed orphaned mcp process", { key, pid })
            } else {
              process.kill(pid, "SIGKILL")
            }
          } catch (killErr) {
            log.debug("failed to kill orphaned mcp process", { key, pid, error: killErr })
          }
        }
        status = {
          status: "failed" as const,
          error: msg,
        }
      }
    }

    if (!status) {
      status = {
        status: "failed" as const,
        error: "Unknown error",
      }
    }

    if (!mcpClient) {
      return {
        mcpClient: undefined,
        status,
      }
    }

    log.info("listing tools from connected mcp client", { key })
    const result = await withTimeout(mcpClient.listTools(), mcp.timeout ?? DEFAULT_TIMEOUT).catch((err) => {
      log.error("listTools timed out or failed", {
        key,
        phase: "listTools",
        error: err instanceof Error ? err.message : String(err),
      })
      return undefined
    })
    if (!result) {
      await mcpClient.close().catch((error) => {
        log.error("Failed to close MCP client", {
          error,
        })
      })
      status = {
        status: "failed",
        error: "Failed to get tools",
      }
      return {
        mcpClient: undefined,
        status: {
          status: "failed" as const,
          error: "Failed to get tools",
        },
      }
    }

    log.info("create() successfully created client", { key, toolCount: result.tools.length })
    const pid = (mcpClient.transport as StdioClientTransport)?.pid
    if (typeof pid === "number") pids.add(pid)
    return {
      mcpClient,
      status,
    }
  }

  export async function status() {
    const s = await state()
    const config = await loadMergedMcpConfigs()
    const result: Record<string, Status> = {}

    // Include all configured MCPs from config, not just connected ones
    for (const [key, mcp] of Object.entries(config)) {
      if (!isMcpConfigured(mcp)) continue
      result[key] = s.status[key] ?? { status: "disabled" }
    }

    return result
  }

  export async function clients() {
    return state().then((state) => state.clients)
  }

  export async function connect(name: string) {
    const config = await loadMergedMcpConfigs()
    const mcp = config[name]
    if (!mcp) {
      log.error("MCP config not found", { name })
      return
    }

    if (!isMcpConfigured(mcp)) {
      log.error("Ignoring MCP connect request for config without type", { name })
      return
    }

    const result = await create(name, { ...mcp, disabled: false })

    if (!result) {
      const s = await state()
      s.status[name] = {
        status: "failed",
        error: "Unknown error during connection",
      }
      return
    }

    const s = await state()
    s.status[name] = result.status
    if (result.mcpClient) {
      // Close existing client if present to prevent memory leaks
      const existingClient = s.clients[name]
      if (existingClient) {
        await existingClient.close().catch((error) => {
          log.error("Failed to close existing MCP client", { name, error })
        })
      }
      s.clients[name] = result.mcpClient
    }

    await Config.update({ mcpServers: { [name]: { disabled: false } } }).catch((error) => {
      log.error("Failed to persist MCP connect state", { name, error })
    })
  }

  export async function ensureConnected(name: string): Promise<void> {
    const s = await state()
    if (s.status[name]?.status === "connected") {
      return
    }
    await connect(name)
  }

  export async function loadMergedMcpConfigs(): Promise<NonNullable<Config.Info["mcpServers"]>> {
    const cfg = await Config.get()
    const config = { ...(cfg.mcpServers ?? {}) }

    const { Flag } = await import("@/flag/flag")
    const profile = Platform.active()
    if (!Flag.LITEAI_DISABLE_PROJECT_CONFIG && profile?.mcpJson) {
      const { load } = await import("./loader")
      const mcpJson = await load(Instance.directory, Instance.worktree)
      if (Object.keys(mcpJson).length > 0) {
        Object.assign(config, mcpJson)
      }
    }
    if (profile?.mcpJson) {
      const { loadFile } = await import("./loader")
      const path = await import("node:path")
      const p = path.join(Global.Path.config, ".mcp.json")
      const globalMcpJson = await loadFile(p).catch(() => ({}))
      if (Object.keys(globalMcpJson).length > 0) {
        Object.assign(config, globalMcpJson)
      }
    }
    return config
  }

  export async function getMcpConfigByName(name: string): Promise<Config.Mcp | undefined> {
    const config = await loadMergedMcpConfigs()
    const mcp = config[name]
    if (mcp && isMcpConfigured(mcp)) {
      return mcp
    }
    return undefined
  }

  export async function disconnect(name: string) {
    const s = await state()
    const client = s.clients[name]
    if (client) {
      await client.close().catch((error) => {
        log.error("Failed to close MCP client", { name, error })
      })
      delete s.clients[name]
    }
    s.status[name] = { status: "disabled" }

    await Config.update({ mcpServers: { [name]: { disabled: true } } }).catch((error) => {
      log.error("Failed to persist MCP disconnect state", { name, error })
    })
  }

  export async function tools(extraClients?: Array<{ name: string; client: MCPClient; config: Config.Mcp }>) {
    const result: Record<string, Tool> = {}
    const s = await state()
    const cfg = await Config.get()
    const config = await loadMergedMcpConfigs()
    const clientsSnapshot = await clients()
    const defaultTimeout = cfg.experimental?.mcp_timeout

    const connectedClients = Object.entries(clientsSnapshot)
      .filter(([name]) => s.status[name]?.status === "connected" && name in config)
      .map(([name, client]) => {
        const mcpConfig = config[name]
        const entry = isMcpConfigured(mcpConfig) ? mcpConfig : undefined
        return { name, client, config: entry }
      })

    const allClients = [...connectedClients, ...(extraClients ?? [])]

    const toolsResults = await Promise.all(
      allClients.map(async ({ name: clientName, client, config: entry }) => {
        const toolsResult = await client.listTools().catch((e) => {
          log.error("failed to get tools", { clientName, error: e.message })
          const failedStatus = {
            status: "failed" as const,
            error: e instanceof Error ? e.message : String(e),
          }
          s.status[clientName] = failedStatus
          delete s.clients[clientName]
          return undefined
        })
        return { clientName, client, toolsResult, entry }
      }),
    )

    for (const { clientName, client, toolsResult, entry } of toolsResults) {
      if (!toolsResult) continue
      const timeout = entry?.timeout ?? defaultTimeout
      for (const mcpTool of toolsResult.tools) {
        const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
        const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
        result[`${sanitizedClientName}_${sanitizedToolName}`] = await convertMcpTool(mcpTool, client, timeout)
      }
    }

    return result
  }

  export async function toolNames() {
    const result: Record<string, string[]> = {}
    const s = await state()
    const config = await loadMergedMcpConfigs()
    const clientsSnapshot = await clients()

    const connected = Object.entries(clientsSnapshot).filter(
      ([name]) => s.status[name]?.status === "connected" && name in config,
    )

    await Promise.all(
      connected.map(async ([name, client]) => {
        const tools = await client.listTools().catch((e) => {
          log.warn("listTools failed for toolNames", { name, error: e })
          return undefined
        })
        if (!tools) return
        result[name] = tools.tools.map((t) => t.name)
      }),
    )
    return result
  }

  export async function prompts() {
    const s = await state()
    const config = await loadMergedMcpConfigs()
    const clientsSnapshot = await clients()

    const prompts = Object.fromEntries<PromptInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected" || !(clientName in config)) {
              return []
            }

            return Object.entries((await fetchPromptsForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return prompts
  }

  export async function resources() {
    const s = await state()
    const config = await loadMergedMcpConfigs()
    const clientsSnapshot = await clients()

    const result = Object.fromEntries<ResourceInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected" || !(clientName in config)) {
              return []
            }

            return Object.entries((await fetchResourcesForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return result
  }

  export async function getPrompt(clientName: string, name: string, args?: Record<string, string>) {
    const clientsSnapshot = await clients()
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for prompt", {
        clientName,
      })
      return undefined
    }

    const result = await client
      .getPrompt({
        name: name,
        arguments: args,
      })
      .catch((e) => {
        log.error("failed to get prompt from MCP server", {
          clientName,
          promptName: name,
          error: e.message,
        })
        return undefined
      })

    return result
  }

  export async function readResource(clientName: string, resourceUri: string) {
    const clientsSnapshot = await clients()
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for prompt", {
        clientName: clientName,
      })
      return undefined
    }

    const result = await client
      .readResource({
        uri: resourceUri,
      })
      .catch((e) => {
        log.error("failed to get prompt from MCP server", {
          clientName: clientName,
          resourceUri: resourceUri,
          error: e.message,
        })
        return undefined
      })

    return result
  }

  /**
   * Start OAuth authentication flow for an MCP server.
   * Returns the authorization URL that should be opened in a browser.
   */
  export async function startAuth(mcpName: string): Promise<{ authorizationUrl: string }> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcpServers?.[mcpName]

    if (!mcpConfig) {
      throw new Error(`MCP server not found: ${mcpName}`)
    }

    if (!isMcpConfigured(mcpConfig)) {
      throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
    }

    if (mcpConfig.type !== "remote") {
      throw new Error(`MCP server ${mcpName} is not a remote server`)
    }

    if (mcpConfig.oauth === false) {
      throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
    }

    // Start the callback server
    await McpOAuthCallback.ensureRunning()

    // Generate and store a cryptographically secure state parameter BEFORE creating the provider
    // The SDK will call provider.state() to read this value
    const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    await McpAuth.updateOAuthState(mcpName, oauthState)

    // Create a new auth provider for this flow
    // OAuth config is optional - if not provided, we'll use auto-discovery
    const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined
    let capturedUrl: URL | undefined
    const authProvider = new McpOAuthProvider(
      mcpName,
      mcpConfig.url,
      {
        clientId: oauthConfig?.clientId,
        clientSecret: oauthConfig?.clientSecret,
        scope: oauthConfig?.scope,
      },
      {
        onRedirect: async (url) => {
          capturedUrl = url
        },
      },
    )

    // Create transport with auth provider
    const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), {
      authProvider,
    })

    // Try to connect - this will trigger the OAuth flow
    try {
      const client = new Client({
        name: "liteai",
        version: Installation.VERSION,
      })
      await client.connect(transport)
      // If we get here, we're already authenticated
      return { authorizationUrl: "" }
    } catch (error) {
      if (error instanceof UnauthorizedError && capturedUrl) {
        // Store transport for finishAuth
        pendingOAuthTransports.set(mcpName, transport)
        return { authorizationUrl: capturedUrl.toString() }
      }
      throw error
    }
  }

  /**
   * Complete OAuth authentication after user authorizes in browser.
   * Opens the browser and waits for callback.
   */
  export async function authenticate(mcpName: string): Promise<Status> {
    const { authorizationUrl } = await startAuth(mcpName)

    if (!authorizationUrl) {
      // Already authenticated
      const s = await state()
      return s.status[mcpName] ?? { status: "connected" }
    }

    // Get the state that was already generated and stored in startAuth()
    const oauthState = await McpAuth.getOAuthState(mcpName)
    if (!oauthState) {
      throw new Error("OAuth state not found - this should not happen")
    }

    // The SDK has already added the state parameter to the authorization URL
    // We just need to open the browser
    log.info("opening browser for oauth", { mcpName, url: authorizationUrl, state: oauthState })

    // Register the callback BEFORE opening the browser to avoid race condition
    // when the IdP has an active SSO session and redirects immediately
    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState)

    try {
      const subprocess = await open(authorizationUrl)
      // The open package spawns a detached process and returns immediately.
      // We need to listen for errors which fire asynchronously:
      // - "error" event: command not found (ENOENT)
      // - "exit" with non-zero code: command exists but failed (e.g., no display)
      await new Promise<void>((resolve, reject) => {
        // Give the process a moment to fail if it's going to
        const timeout = setTimeout(() => resolve(), 500)
        subprocess.on("error", (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        subprocess.on("exit", (code) => {
          if (code !== null && code !== 0) {
            clearTimeout(timeout)
            reject(new Error(`Browser open failed with exit code ${code}`))
          }
        })
      })
    } catch (error) {
      // Browser opening failed (e.g., in remote/headless sessions like SSH, devcontainers)
      // Emit event so CLI can display the URL for manual opening
      log.warn("failed to open browser, user must open URL manually", { mcpName, error })
      Bus.publish(BrowserOpenFailed, { mcpName, url: authorizationUrl })
    }

    // Wait for callback using the already-registered promise
    const code = await callbackPromise

    // Validate and clear the state
    const storedState = await McpAuth.getOAuthState(mcpName)
    if (storedState !== oauthState) {
      await McpAuth.clearOAuthState(mcpName)
      throw new Error("OAuth state mismatch - potential CSRF attack")
    }

    await McpAuth.clearOAuthState(mcpName)

    // Finish auth
    return finishAuth(mcpName, code)
  }

  /**
   * Complete OAuth authentication with the authorization code.
   */
  export async function finishAuth(mcpName: string, authorizationCode: string): Promise<Status> {
    const transport = pendingOAuthTransports.get(mcpName)

    if (!transport) {
      throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)
    }

    try {
      // Call finishAuth on the transport
      await transport.finishAuth(authorizationCode)

      // Clear the code verifier after successful auth
      await McpAuth.clearCodeVerifier(mcpName)

      // Now try to reconnect
      const cfg = await Config.get()
      const mcpConfig = cfg.mcpServers?.[mcpName]

      if (!mcpConfig) {
        throw new Error(`MCP server not found: ${mcpName}`)
      }

      if (!isMcpConfigured(mcpConfig)) {
        throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
      }

      // Re-add the MCP server to establish connection
      pendingOAuthTransports.delete(mcpName)
      const result = await add(mcpName, mcpConfig)

      const statusRecord = result.status as Record<string, Status>
      return statusRecord[mcpName] ?? { status: "failed", error: "Unknown error after auth" }
    } catch (error) {
      log.error("failed to finish oauth", { mcpName, error })
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Remove OAuth credentials for an MCP server.
   */
  export async function removeAuth(mcpName: string): Promise<void> {
    await McpAuth.remove(mcpName)
    McpOAuthCallback.cancelPending(mcpName)
    pendingOAuthTransports.delete(mcpName)
    await McpAuth.clearOAuthState(mcpName)
    log.info("removed oauth credentials", { mcpName })
  }

  /**
   * Check if an MCP server supports OAuth (remote servers support OAuth by default unless explicitly disabled).
   */
  export async function supportsOAuth(mcpName: string): Promise<boolean> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcpServers?.[mcpName]
    if (!mcpConfig) return false
    if (!isMcpConfigured(mcpConfig)) return false
    return mcpConfig.type === "remote" && mcpConfig.oauth !== false
  }

  /**
   * Check if an MCP server has stored OAuth tokens.
   */
  export async function hasStoredTokens(mcpName: string): Promise<boolean> {
    const entry = await McpAuth.get(mcpName)
    return !!entry?.tokens
  }

  export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

  /**
   * Get the authentication status for an MCP server.
   */
  export async function getAuthStatus(mcpName: string): Promise<AuthStatus> {
    const hasTokens = await hasStoredTokens(mcpName)
    if (!hasTokens) return "not_authenticated"
    const expired = await McpAuth.isTokenExpired(mcpName)
    return expired ? "expired" : "authenticated"
  }
}
