import path from "node:path"
import { Module } from "@liteai/util/module"
import { BunProc } from "../../bun"
import { Flag } from "../../flag/flag"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import { Filesystem } from "../../util/filesystem"
import { Process } from "../../util/process"
import { which } from "../../util/which"
import type { Info } from "./types"
import { log, NearestRoot, spawn } from "./util"

export const Astro: Info = {
  id: "astro",
  extensions: [".astro"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    const tsserver = Module.resolve("typescript/lib/tsserver.js", Instance.directory)
    if (!tsserver) {
      log.info("typescript not found, required for Astro language server")
      return
    }
    const tsdk = path.dirname(tsserver)

    let binary = which("astro-ls")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "@astrojs", "language-server", "bin", "nodeServer.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.LITEAI_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "@astrojs/language-server"], {
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
      binary = BunProc.which()
      args.push("run", js)
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
      initialization: {
        typescript: {
          tsdk,
        },
      },
    }
  },
}
