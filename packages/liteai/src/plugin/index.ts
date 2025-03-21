import { createLiteaiClient } from "@liteai-ai/sdk"
import { Bus } from "../bus"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Instance } from "../project/instance"
import { Server } from "../server/server"
import { Log } from "../util/log"
import { CodeAssistAuthPlugin } from "./code-assist"
import { CodexAuthPlugin } from "./codex"
import { CopilotAuthPlugin } from "./copilot"
import type { Hooks, Plugin as PluginInstance } from "./types"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  // Built-in plugins that are directly imported (not installed from npm)
  const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin, CodeAssistAuthPlugin]

  const state = Instance.state(async () => {
    const client = createLiteaiClient({
      baseUrl: "http://localhost:9000",
      directory: Instance.directory,
      headers: Flag.LITEAI_SERVER_PASSWORD
        ? {
            Authorization: `Basic ${Buffer.from(`${Flag.LITEAI_SERVER_USERNAME ?? "liteai"}:${Flag.LITEAI_SERVER_PASSWORD}`).toString("base64")}`,
          }
        : undefined,
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => Server.Default().fetch(new Request(input, init)),
        { preconnect: (_url: string | URL) => {} },
      ) as typeof fetch,
    })
    const hooks: Hooks[] = []
    const input = {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic
      client: client as any,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      get serverUrl(): URL {
        return Server.url ?? new URL("http://localhost:9000")
      },
      $: Bun.$,
    }

    for (const plugin of INTERNAL_PLUGINS) {
      log.info("loading internal plugin", { name: plugin.name })
      const init = await plugin(input).catch((err) => {
        log.error("failed to load internal plugin", { name: plugin.name, error: err })
      })
      if (init) hooks.push(init)
    }

    return {
      hooks,
      input,
    }
  })

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    for (const hook of await state().then((x) => x.hooks)) {
      const fn = hook[name]
      if (!fn) continue
      // @ts-expect-error if you feel adventurous, please fix the typing, make sure to bump the try-counter if you
      // give up.
      // try-counter: 2
      await fn(input, output)
    }
    return output
  }

  export async function list() {
    return state().then((x) => x.hooks)
  }

  export async function init() {
    const hooks = await state().then((x) => x.hooks)
    const config = await Config.get()
    for (const hook of hooks) {
      await hook.config?.(config)
    }
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const hook of hooks) {
        hook.event?.({
          event: input,
        })
      }
    })
  }
}
