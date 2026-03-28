import { GlobalBus } from "@liteai/core/bus/global"
import { Config } from "@liteai/core/config/config"
import { Flag } from "@liteai/core/flag/flag"
import { Installation } from "@liteai/core/installation/index"
import { InstanceBootstrap } from "@liteai/core/project/bootstrap"
import { Instance } from "@liteai/core/project/instance"
import { Server } from "@liteai/core/server/server"
import { Log } from "@liteai/core/util/log"
import { Rpc } from "@liteai/core/util/rpc"
import type { Event } from "@liteai/sdk"
import { NamedError } from "@liteai/util/error"
import type { BunWebSocketData } from "hono/bun"
import { upgrade } from "../../upgrade"

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

function serializeError(e: unknown) {
  if (e instanceof NamedError) return { ...e.toObject(), stack: e.stack }
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack, cause: e.cause }
  return { value: e }
}

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", serializeError(e))
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", serializeError(e))
})

// Forward global bus events to the main thread via RPC.
// Unwrap the { directory, payload } wrapper — the TUI expects { type, properties }.
GlobalBus.on("event", (event) => {
  if (event?.payload) {
    Rpc.emit("event", event.payload)
  }
})

let server: Bun.Server<BunWebSocketData> | undefined



export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = getAuthorizationHeader()
    if (auth && !headers.authorization && !headers.Authorization) {
      headers.Authorization = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    Config.global.reset()
    await Instance.disposeAll()
  },
  async setWorkspace(_input: { workspaceID?: string }) {
    // TODO: workspace filtering — re-implement if needed
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    await Instance.disposeAll()
    if (server) server.stop(true)
  },
}

Rpc.listen(rpc)

// Clean up LSP servers if parent dies and we receive a signal
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    Log.Default.info("worker received signal, shutting down", { signal })
    await rpc.shutdown()
    process.exit(0)
  })
}

function getAuthorizationHeader(): string | undefined {
  const password = Flag.LITEAI_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.LITEAI_SERVER_USERNAME ?? "liteai"
  return `Basic ${btoa(`${username}:${password}`)}`
}
