import path from "node:path"
import { BunProc } from "../../bun"
import { Flag } from "../../flag/flag"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import { Process } from "../../util/process"
import { which } from "../../util/which"
import type { Info } from "./types"
import { NearestRoot, spawn } from "./util"

export const YamlLS: Info = {
  id: "yaml-ls",
  extensions: [".yaml", ".yml"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    let binary = which("yaml-language-server")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "yaml-language-server", "out", "server", "src", "server.js")
      const exists = await Filesystem.exists(js)
      if (!exists) {
        if (Flag.LITEAI_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "yaml-language-server"], {
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
    }
  },
}
