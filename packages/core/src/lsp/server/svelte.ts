import path from "node:path"
import { Process } from "@liteai/util/process"
import { which } from "@liteai/util/which"
import { BunProc } from "../../bun"
import { Flag } from "../../flag/flag"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import type { Info } from "./types"
import { NearestRoot, spawn } from "./util"

export const Svelte: Info = {
  id: "svelte",
  extensions: [".svelte"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    let binary = which("svelteserver")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "svelte-language-server", "bin", "server.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.LITEAI_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "svelte-language-server"], {
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
      initialization: {},
    }
  },
}
