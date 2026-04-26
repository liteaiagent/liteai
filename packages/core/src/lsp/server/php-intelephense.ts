import path from "node:path"
import { Process } from "@liteai/util/process"
import { which } from "@liteai/util/which"
import { BunProc } from "../../bun"
import { Flag } from "../../flag/flag"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import type { Info } from "./types"
import { NearestRoot, spawn } from "./util"

export const PHPIntelephense: Info = {
  id: "php intelephense",
  extensions: [".php"],
  root: NearestRoot(["composer.json", "composer.lock", ".php-version"]),
  async spawn(root) {
    let binary = which("intelephense")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "intelephense", "lib", "intelephense.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.LITEAI_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "intelephense"], {
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
        telemetry: {
          enabled: false,
        },
      },
    }
  },
}
