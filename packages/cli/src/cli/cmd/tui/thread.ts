import path from "node:path"
import { fileURLToPath } from "node:url"
import { Instance } from "@liteai/core/project/instance"
import { Project } from "@liteai/core/project/project"
import { Fs as Filesystem } from "@liteai/util/fs"
import { Log } from "@liteai/util/log"
import { Rpc } from "@liteai/util/rpc"
import { withTimeout } from "@liteai/util/timeout"
import { TuiConfig } from "../../config/tui"
import { resolveNetworkOptions, withNetworkOptions } from "../../network"
import { UI } from "../../ui"
import { cmd } from "../cmd"
import { tui } from "./app"
import type { LocalRpcApi } from "./local-server"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import type { rpc } from "./worker"

declare global {
  const LITEAI_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

async function target() {
  if (typeof LITEAI_WORKER_PATH !== "undefined") return LITEAI_WORKER_PATH
  const dist = new URL("./cli/cmd/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("./worker.ts", import.meta.url)
}

async function readPipedInput(timeoutMs = 500): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined

  return new Promise((resolve) => {
    let data = ""
    let timeout: ReturnType<typeof setTimeout> | null = null

    const onData = (chunk: Buffer | string) => {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      data += chunk.toString()
    }

    const onEnd = () => {
      cleanup()
      resolve(data || undefined)
    }

    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      process.stdin.off("data", onData)
      process.stdin.off("end", onEnd)
    }

    // Give up if no data arrives within timeoutMs
    timeout = setTimeout(() => {
      cleanup()
      resolve(undefined) // Timeout reached, assume interactive shell
    }, timeoutMs)

    process.stdin.on("data", onData)
    process.stdin.once("end", onEnd)
  })
}

async function input(value?: string) {
  const piped = await readPipedInput(500)
  if (!value) return piped
  if (!piped) return value
  return `${piped}\n${value}`
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start liteai tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start liteai in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      }),
  handler: async (args) => {
    // Keep ENABLE_PROCESSED_INPUT cleared even if other code flips it.
    // (Important when running under `bun run` wrappers on Windows.)
    const unguard = win32InstallCtrlCGuard()
    try {
      // Must be the very first thing — disables CTRL_C_EVENT before any Worker
      // spawn or async work so the OS cannot kill the process group.
      win32DisableProcessedInput()

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      // Resolve relative --project paths from PWD, then use the real cwd after
      // chdir so the thread and worker share the same directory key.
      const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
      const next = (args.project as string | undefined)
        ? Filesystem.resolve(
            path.isAbsolute(args.project as string)
              ? (args.project as string)
              : path.join(root, args.project as string),
          )
        : Filesystem.resolve(process.cwd())
      const file = await target()
      try {
        process.chdir(next)
      } catch {
        UI.error(`Failed to change directory to ${next}`)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      const network = await resolveNetworkOptions(args)
      const external =
        process.argv.includes("--port") ||
        process.argv.includes("--hostname") ||
        process.argv.includes("--mdns") ||
        network.mdns ||
        network.port !== 0 ||
        network.hostname !== "127.0.0.1"

      let worker: Worker | undefined
      let client: LocalRpcApi | RpcClient
      // Lazily loaded — only evaluated in local (non-Worker) mode to avoid
      // pulling ~7 @liteai/core modules into the main thread when using a Worker.
      let localFetch: typeof fetch | undefined
      let localEvents: ReturnType<typeof import("./local-server").createLocalEventSource> | undefined

      if (external) {
        worker = new Worker(file, {
          env: Object.fromEntries(
            Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
          ),
        })
        worker.onerror = (e) => {
          Log.Default.error(e)
        }

        client = Rpc.client<typeof rpc>({
          postMessage: (data: string) => {
            worker?.postMessage(data)
            return undefined
          },
          // biome-ignore lint/suspicious/noExplicitAny: must match Worker.onmessage signature
          set onmessage(handler: ((ev: MessageEvent<any>) => any) | null) {
            if (worker) worker.onmessage = handler
          },
        })
      } else {
        const localServer = await import("./local-server")
        await localServer.bootLocalServer()
        client = localServer.localRpc
        localFetch = localServer.createLocalFetch()
        localEvents = localServer.createLocalEventSource()
      }

      const error = (e: unknown) => {
        Log.Default.error(e)
      }
      const reload = () => {
        const reloadCall = external ? (client as RpcClient).call("reload", undefined) : (client as LocalRpcApi).reload()
        reloadCall.catch((err) => {
          Log.Default.warn("worker reload failed", {
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }
      process.on("uncaughtException", error)
      process.on("unhandledRejection", error)
      process.on("SIGUSR2", reload)

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        process.off("uncaughtException", error)
        process.off("unhandledRejection", error)
        process.off("SIGUSR2", reload)

        const shutdownPromise = external
          ? (client as RpcClient).call("shutdown", undefined)
          : (client as LocalRpcApi).shutdown()

        await withTimeout(shutdownPromise as Promise<void>, 5000).catch((error) => {
          Log.Default.warn("worker shutdown failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        if (worker) worker.terminate()
      }

      const prompt = await input(args.prompt as string | undefined)

      // Register the project for this directory so Instance.provide can boot
      const projectResult = await Project.fromDirectory(cwd).catch((err) => {
        Log.Default.warn("project init failed", { error: String(err) })
        return undefined
      })
      const projectID = projectResult?.project.id

      const config = await Instance.provide({
        directory: cwd,
        fn: () => TuiConfig.get(),
      })

      const transport = external
        ? {
            url: (await (client as RpcClient).call("server", network)).url,
            fetch: undefined,
            events: undefined,
          }
        : {
            url: "http://liteai.internal",
            fetch: localFetch,
            events: localEvents,
          }

      setTimeout(() => {
        const checkCall = external
          ? (client as RpcClient).call("checkUpgrade", { directory: cwd })
          : (client as LocalRpcApi).checkUpgrade({ directory: cwd })
        checkCall.catch(() => {})
      }, 1000).unref?.()

      try {
        await tui({
          url: transport.url,
          config,
          directory: cwd,
          projectID,
          fetch: transport.fetch,
          events: transport.events,
          args: {
            continue: args.continue as boolean | undefined,
            sessionID: args.session as string | undefined,
            agent: args.agent as string | undefined,
            model: args.model as string | undefined,
            prompt,
            fork: args.fork as boolean | undefined,
          },
        })
      } finally {
        await stop()
      }
    } finally {
      unguard?.()
    }
    process.exit(0)
  },
})
