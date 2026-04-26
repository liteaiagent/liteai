import path from "node:path"
import { Process } from "@liteai/util/process"
import { which } from "@liteai/util/which"
import { Flag } from "../../flag/flag"
import { Global } from "../../global"
import type { Info } from "./types"
import { log, NearestRoot, spawn } from "./util"

export const Rubocop: Info = {
  id: "ruby-lsp",
  root: NearestRoot(["Gemfile"]),
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async spawn(root) {
    let bin = which("rubocop", {
      PATH: process.env.PATH + path.delimiter + Global.Path.bin,
    })
    if (!bin) {
      const ruby = which("ruby")
      const gem = which("gem")
      if (!ruby || !gem) {
        log.info("Ruby not found, please install Ruby first")
        return
      }
      if (Flag.LITEAI_DISABLE_LSP_DOWNLOAD) return
      log.info("installing rubocop")
      const proc = Process.spawn(["gem", "install", "rubocop", "--bindir", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install rubocop")
        return
      }
      bin = path.join(Global.Path.bin, `rubocop${process.platform === "win32" ? ".exe" : ""}`)
      log.info(`installed rubocop`, {
        bin,
      })
    }
    return {
      process: spawn(bin, ["--lsp"], {
        cwd: root,
      }),
    }
  },
}
