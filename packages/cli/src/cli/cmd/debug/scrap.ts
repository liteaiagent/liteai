import { EOL } from "node:os"
import { Project } from "@liteai/core/project/project"
import { Log } from "@liteai/core/util/log"
import { cmd } from "../cmd"

export const ScrapCommand = cmd({
  command: "scrap",
  describe: "list all known projects",
  builder: (yargs) => yargs,
  async handler() {
    const timer = Log.Default.time("scrap")
    const list = await Project.list()
    process.stdout.write(JSON.stringify(list, null, 2) + EOL)
    timer.stop()
  },
})
