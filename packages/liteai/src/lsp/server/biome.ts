import path from "node:path"
import { Module } from "@liteai/util/module"
import { BunProc } from "../../bun"
import { Flag } from "../../flag/flag"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import { Process } from "../../util/process"
import { which } from "../../util/which"
import type { Info } from "./types"
import { log, NearestRoot, spawn } from "./util"

export const Biome: Info = {
  id: "biome",
  root: NearestRoot([
    "biome.json",
    "biome.jsonc",
    "package-lock.json",
    "bun.lockb",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
  ]),
  extensions: [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".json",
    ".jsonc",
    ".vue",
    ".astro",
    ".svelte",
    ".css",
    ".graphql",
    ".gql",
    ".html",
  ],
  async spawn(root) {
    const localBin = path.join(root, "node_modules", ".bin", "biome")
    let bin: string | undefined
    if (await Filesystem.exists(localBin)) bin = localBin
    if (!bin) {
      const found = which("biome")
      if (found) bin = found
    }

    let args = ["lsp-proxy", "--stdio"]

    if (!bin) {
      const resolved = Module.resolve("biome", root)
      if (resolved) {
        bin = BunProc.which()
        args = ["x", "biome", "lsp-proxy", "--stdio"]
      }
    }

    if (!bin) {
      const js = path.join(Global.Path.bin, "node_modules", "@biomejs", "biome", "bin", "biome")
      if (!(await Filesystem.exists(js))) {
        if (Flag.LITEAI_DISABLE_LSP_DOWNLOAD) return
        log.info("installing @biomejs/biome")
        await Process.spawn([BunProc.which(), "install", "@biomejs/biome"], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        }).exited
      }
      if (!(await Filesystem.exists(js))) return
      bin = BunProc.which()
      args = ["run", js, "lsp-proxy", "--stdio"]
    }

    const proc = spawn(bin, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })

    return {
      process: proc,
    }
  },
}
