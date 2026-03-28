import { setTimeout as sleep } from "node:timers/promises"
import { GlobalBus } from "@liteai/core/bus/global"
import { Config } from "@liteai/core/config/config"
import { Flag } from "@liteai/core/flag/flag"
import { Installation } from "@liteai/core/installation/index"
import { InstanceBootstrap } from "@liteai/core/project/bootstrap"
import { Instance } from "@liteai/core/project/instance"
import { Server } from "@liteai/core/server/server"
import { Log } from "@liteai/core/util/log"
import { Rpc } from "@liteai/core/util/rpc"
import { createLiteaiClient, type Event } from "@liteai/sdk"
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

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Bun.Server<BunWebSocketData> | undefined

const eventStream = {
  abort: undefined as AbortController | undefined,
}

const startEventStream = (input: { directory: string; workspaceID?: string }) => {
  if (eventStream.abort) eventStream.abort.abort()
  const abort = new AbortController()
  eventStream.abort = abort
  const signal = abort.signal

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const auth = getAuthorizationHeader()
    if (auth) request.headers.set("Authorization", auth)
    return Server.Default().fetch(request)
  }) as typeof globalThis.fetch

  const sdk = createLiteaiClient({
    baseUrl: "http://liteai.internal",
    experimental_workspaceID: input.workspaceID,
    fetch: fetchFn,
    signal,
  })

  ;(async () => {
    while (!signal.aborted) {
      const events = await Promise.resolve(
        sdk.event.subscribe({
          signal,
        }),
      ).catch(() => undefined)

      if (!events) {
        await sleep(250)
        continue
      }

      for await (const event of events.stream) {
        Rpc.emit("event", event as unknown as Event)
      }

      if (!signal.aborted) {
        await sleep(250)
      }
    }
  })().catch((error) => {
    Log.Default.error("event stream error", {
      error: error instanceof Error ? error.message : error,
    })
  })
}

startEventStream({ directory: process.cwd() })

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
  async setWorkspace(input: { workspaceID?: string }) {
    startEventStream({ directory: process.cwd(), workspaceID: input.workspaceID })
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    if (eventStream.abort) eventStream.abort.abort()
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
