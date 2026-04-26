import { spawn as launch } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import { Process } from "@liteai/util/process"
import { Instance } from "../../project/instance"
import { Filesystem } from "../../util/filesystem"

export const spawn = ((cmd, args, opts) => {
  const proc = Array.isArray(args)
    ? launch(cmd, [...args], { ...(opts ?? {}), windowsHide: true })
    : launch(cmd, { ...(args ?? {}), windowsHide: true })
  // prevent unhandled 'error' events (e.g. ENOENT) from crashing the process
  proc.on("error", () => {})
  return proc
}) as typeof launch

export const log = Log.create({ service: "lsp.server" })

export const pathExists = async (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false)

export const run = (cmd: string[], opts: Process.RunOptions = {}) => Process.run(cmd, { ...opts, nothrow: true })

export const output = (cmd: string[], opts: Process.RunOptions = {}) => Process.text(cmd, { ...opts, nothrow: true })

export const NearestRoot = (includePatterns: string[], excludePatterns?: string[]) => {
  return async (file: string) => {
    if (excludePatterns) {
      const excludedFiles = Filesystem.up({
        targets: excludePatterns,
        start: path.dirname(file),
        stop: Instance.directory,
      })
      const excluded = await excludedFiles.next()
      await excludedFiles.return()
      if (excluded.value) return undefined
    }
    const files = Filesystem.up({
      targets: includePatterns,
      start: path.dirname(file),
      stop: Instance.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return Instance.directory
    return path.dirname(first.value)
  }
}
