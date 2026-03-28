import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { xdgCache, xdgData, xdgState } from "xdg-basedir"
import { Brand } from "../brand"
import { Flag } from "../flag/flag"
import { Filesystem } from "../util/filesystem"

const app = Brand.app

const root = Flag.LITEAI_HOME || path.join(os.homedir(), Brand.home)
const data = path.join(xdgData as string, app)
const cache = path.join(xdgCache as string, app)
const config = root
const state = path.join(xdgState as string, app)

export namespace Global {
  export const Path = {
    // Allow override via LITEAI_TEST_HOME for test isolation
    get home() {
      return process.env.LITEAI_TEST_HOME || os.homedir()
    },
    root,
    data,
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Global.Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (_e) {}
  await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION)
}
