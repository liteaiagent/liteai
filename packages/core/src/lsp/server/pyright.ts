import path from "node:path"
import { Process } from "@liteai/util/process"
import { which } from "@liteai/util/which"
import { BunProc } from "../../bun"
import { Flag } from "../../flag/flag"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import type { Info } from "./types"
import { NearestRoot, spawn } from "./util"

export const Pyright: Info = {
  id: "pyright",
  extensions: [".py", ".pyi"],
  priority: 20,
  root: NearestRoot(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]),
  async spawn(root) {
    let binary = which("pyright-langserver")
    const args = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "pyright", "dist", "pyright-langserver.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.LITEAI_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "pyright"], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
        }).exited
      }
      binary = BunProc.which()
      args.push(...["run", js])
    }
    args.push("--stdio")

    const initialization: Record<string, string> = {}

    const potentialVenvPaths = [process.env.VIRTUAL_ENV, path.join(root, ".venv"), path.join(root, "venv")].filter(
      (p): p is string => p !== undefined,
    )
    for (const venvPath of potentialVenvPaths) {
      const isWindows = process.platform === "win32"
      const potentialPythonPath = isWindows
        ? path.join(venvPath, "Scripts", "python.exe")
        : path.join(venvPath, "bin", "python")
      if (await Filesystem.exists(potentialPythonPath)) {
        initialization.pythonPath = potentialPythonPath
        break
      }
    }

    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
      initialization,
    }
  },
}
