import path from "node:path"
import { Flag } from "../../flag/flag"
import { Global } from "../../global"
import { Process } from "../../util/process"
import { which } from "../../util/which"
import type { Info } from "./types"
import { log, NearestRoot, spawn } from "./util"

export const CSharp: Info = {
  id: "csharp",
  root: NearestRoot([".slnx", ".sln", ".csproj", "global.json"]),
  extensions: [".cs"],
  async spawn(root) {
    let bin = which("csharp-ls", {
      PATH: process.env.PATH + path.delimiter + Global.Path.bin,
    })
    if (!bin) {
      if (!which("dotnet")) {
        log.error(".NET SDK is required to install csharp-ls")
        return
      }

      if (Flag.LITEAI_DISABLE_LSP_DOWNLOAD) return
      log.info("installing csharp-ls via dotnet tool")
      const proc = Process.spawn(["dotnet", "tool", "install", "csharp-ls", "--tool-path", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install csharp-ls")
        return
      }

      bin = path.join(Global.Path.bin, `csharp-ls${process.platform === "win32" ? ".exe" : ""}`)
      log.info(`installed csharp-ls`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}
