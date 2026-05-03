import { GlobalBus } from "@liteai/core/bus/global"
import { Config } from "@liteai/core/config/config"
import { Flag } from "@liteai/core/flag/flag"
import { InstanceBootstrap } from "@liteai/core/project/bootstrap"
import { Instance } from "@liteai/core/project/instance"
import { Runtime } from "@liteai/core/runtime"
import { Server } from "@liteai/core/server/server"
import type { Event } from "@liteai/sdk"
import { Log } from "@liteai/util/log"
import type { EventSource } from "../../../tui/context/sdk"
import { upgrade } from "../../upgrade"

export async function bootLocalServer() {
  await Runtime.boot({
    printLogs: process.argv.includes("--print-logs"),
    debug: false,
  })
}

function getAuthorizationHeader(): string | undefined {
  const password = Flag.LITEAI_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.LITEAI_SERVER_USERNAME ?? "liteai"
  return `Basic ${btoa(`${username}:${password}`)}`
}

export function createLocalFetch() {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const auth = getAuthorizationHeader()
    if (auth && !request.headers.has("authorization") && !request.headers.has("Authorization")) {
      request.headers.set("Authorization", auth)
    }
    return await Server.Default().fetch(request)
  }
  return fn as typeof fetch
}

export function createLocalEventSource(): EventSource {
  return {
    on: (handler) => {
      const callback = (event: unknown) => {
        if (event && typeof event === "object" && "payload" in event && event.payload) {
          handler(event.payload as Event)
        }
      }
      GlobalBus.on("event", callback)
      return () => {
        GlobalBus.off("event", callback)
      }
    },
    setWorkspace: (_workspaceID) => {
      // TODO: workspace filtering
    },
  }
}

export interface LocalRpcApi {
  checkUpgrade(input: { directory: string }): Promise<void>
  reload(): Promise<void>
  shutdown(): Promise<void>
}

export const localRpc: LocalRpcApi = {
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
  async shutdown() {
    Log.Default.info("local server shutting down")
    await Runtime.shutdown()
  },
}
