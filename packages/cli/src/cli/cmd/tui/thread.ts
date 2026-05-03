import path from "node:path"
import { Instance } from "@liteai/core/project/instance"
import { Project } from "@liteai/core/project/project"
import { Fs as Filesystem } from "@liteai/util/fs"
import { Log } from "@liteai/util/log"
import { withTimeout } from "@liteai/util/timeout"
import { TuiConfig } from "../../config/tui"
import { UI } from "../../ui"
import { cmd } from "../cmd"
import { tui } from "./app"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"

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
    yargs
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
      try {
        process.chdir(next)
      } catch {
        UI.error(`Failed to change directory to ${next}`)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      const localServer = await import("./local-server")
      await localServer.bootLocalServer()
      const client = localServer.localRpc
      const localFetch = localServer.createLocalFetch()
      const localEvents = localServer.createLocalEventSource()

      const error = (e: unknown) => {
        Log.Default.error(e)
      }
      const reload = () => {
        client.reload().catch((err) => {
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

        await withTimeout(client.shutdown(), 5000).catch((error) => {
          Log.Default.warn("worker shutdown failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
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

      const transport = {
        url: "http://liteai.internal",
        fetch: localFetch,
        events: localEvents,
      }

      setTimeout(() => {
        client.checkUpgrade({ directory: cwd }).catch(() => {})
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
