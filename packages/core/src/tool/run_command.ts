import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Language } from "web-tree-sitter"
import z from "zod"
import type { BackgroundTaskRegistry } from "@/command/background"
import { interpretCommandResult } from "@/command/semantics"
import { BashArity } from "@/permission/arity"
import { Shell } from "@/shell/shell"

import { Filesystem } from "@/util/filesystem"
import { lazy } from "@/util/lazy"
import DESCRIPTION from "../bundled/prompts/tools/run_command.txt"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Tool } from "./tool"
import { Truncate } from "./truncation"

const MAX_METADATA_LENGTH = 30_000
const MAX_WAIT_BEFORE_ASYNC_MS = 10_000

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

export const RunCommandTool = Tool.define("run_command", async () => {
  const shell = Shell.acceptable()
  log.info("run_command tool using shell", { shell })

  return {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional replaceAll patterns matching template placeholders
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional replaceAll patterns matching template placeholders
      .replaceAll("${shell}", shell)
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional replaceAll patterns matching template placeholders
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional replaceAll patterns matching template placeholders
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      WaitMsBeforeAsync: z
        .number()
        .min(0)
        .max(MAX_WAIT_BEFORE_ASYNC_MS)
        .describe(
          `Milliseconds to wait for completion before backgrounding (max ${MAX_WAIT_BEFORE_ASYNC_MS}). If the command completes within this window, output is returned inline. Otherwise, a background task ID is returned for use with command_status.`,
        ),
      cwd: z
        .string()
        .describe(`Working directory. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`)
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const cwd = params.cwd || Instance.directory

      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()

      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue

        // Get full command text including redirects if present
        const commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text

        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            const resolved = await fs.realpath(path.resolve(cwd, arg)).catch(() => "")
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              const normalized =
                process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
              if (!Instance.containsPath(normalized)) {
                const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
                directories.add(dir)
              }
            }
          }
        }

        // cd covered by above check
        if (command.length && command[0] !== "cd") {
          patterns.add(commandText)
          always.add(`${BashArity.prefix(command).join(" ")} *`)
        }
      }

      if (directories.size > 0) {
        const globs = Array.from(directories).map((dir) => {
          // Preserve POSIX-looking paths with /s, even on Windows
          if (dir.startsWith("/")) return `${dir.replace(/[\\/]+$/, "")}/*`
          return path.join(dir, "*")
        })
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "run_command",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      const proc = spawn(params.command, {
        shell,
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: process.platform === "win32",
      })

      let output = ""

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            // truncate the metadata to avoid GIANT blobs of data (has nothing to do w/ what agent can access)
            output: output.length > MAX_METADATA_LENGTH ? `${output.slice(0, MAX_METADATA_LENGTH)}\n\n...` : output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      // Race: completion vs WaitMsBeforeAsync
      const completionPromise = new Promise<"completed">((resolve, reject) => {
        proc.once("exit", () => {
          exited = true
          resolve("completed")
        })
        proc.once("error", (error) => {
          exited = true
          reject(error)
        })
      })

      const timeoutPromise = new Promise<"timeout">((resolve) => {
        const timer = setTimeout(() => resolve("timeout"), params.WaitMsBeforeAsync)
        timer.unref()
      })

      const raceResult = await Promise.race([completionPromise, timeoutPromise])

      if (raceResult === "timeout" && !exited) {
        // Prevent unhandled rejection if it fails in the background before task is fully registered
        completionPromise.catch(() => {})

        // Command didn't finish in time — background it
        ctx.abort.removeEventListener("abort", abortHandler)

        // Remove our listeners (BackgroundTask will manage its own)
        proc.stdout?.removeListener("data", append)
        proc.stderr?.removeListener("data", append)

        const registry = ctx.extra?.backgroundTaskRegistry as BackgroundTaskRegistry | undefined
        if (!registry) {
          // No registry available — fall back to killing the process
          log.warn("No BackgroundTaskRegistry available, killing timed-out process")
          await kill()
          throw new Error(
            "Command did not complete within the wait period and background task support is not available in this session",
          )
        }

        const task = registry.register(proc, {
          command: params.command,
          description: params.description,
        })

        // Seed the background task's buffer with output we already collected
        if (output) {
          task.output.append(output)
        }

        log.info("Command backgrounded", { id: task.id, command: params.command })

        return {
          title: params.description,
          metadata: {
            output: output.length > MAX_METADATA_LENGTH ? `${output.slice(0, MAX_METADATA_LENGTH)}\n\n...` : output,
            exit: null as number | null,
            description: params.description,
            backgroundTaskId: task.id,
          },
          output: `Command is still running in the background.\nBackground task ID: ${task.id}\nUse command_status with this ID to check progress and retrieve output.`,
        }
      }

      // Command completed within the wait window — return inline result
      ctx.abort.removeEventListener("abort", abortHandler)

      const resultMetadata: string[] = []

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      // Semantic exit-code interpretation
      const interpretation = interpretCommandResult(params.command, proc.exitCode ?? 0, output, "")
      if (interpretation.message) {
        resultMetadata.push(interpretation.message)
      }

      if (resultMetadata.length > 0) {
        output += `\n\n<run_command_metadata>\n${resultMetadata.join("\n")}\n</run_command_metadata>`
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? `${output.slice(0, MAX_METADATA_LENGTH)}\n\n...` : output,
          exit: proc.exitCode as number | null,
          description: params.description,
          backgroundTaskId: undefined as string | undefined,
        },
        output,
      }
    },
  }
})
