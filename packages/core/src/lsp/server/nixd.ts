import { which } from "@liteai/util/which"
import { Instance } from "../../project/instance"
import type { Info } from "./types"
import { log, NearestRoot, spawn } from "./util"

export const Nixd: Info = {
  id: "nixd",
  extensions: [".nix"],
  root: async (file) => {
    const flakeRoot = await NearestRoot(["flake.nix"])(file)
    if (flakeRoot && flakeRoot !== Instance.directory) return flakeRoot

    if (Instance.worktree && Instance.worktree !== Instance.directory) return Instance.worktree

    return Instance.directory
  },
  async spawn(root) {
    const nixd = which("nixd")
    if (!nixd) {
      log.info("nixd not found, please install nixd first")
      return
    }
    return {
      process: spawn(nixd, [], {
        cwd: root,
        env: {
          ...process.env,
        },
      }),
    }
  },
}
