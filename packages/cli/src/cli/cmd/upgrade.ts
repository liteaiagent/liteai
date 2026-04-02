import * as prompts from "@clack/prompts"
import { Installation } from "@liteai/core/installation/index"
import type { Argv } from "yargs"
import { UI } from "../ui"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade liteai to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs.positional("target", {
      describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
      type: "string",
    })
  },
  handler: async (args: { target?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    const method = await Installation.method()

    if (method === "unknown") {
      prompts.log.error(`liteai is installed to ${process.execPath} and is running locally, cannot safely upgrade`)
      prompts.outro("Done")
      return
    }

    const target = args.target ? args.target.replace(/^v/, "") : await Installation.latest()

    if (Installation.VERSION === target) {
      prompts.log.warn(`liteai upgrade skipped: ${target} is already installed`)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${Installation.VERSION} → ${target}`)
    const spinner = prompts.spinner()
    spinner.start("Upgrading...")
    const err = await Installation.upgrade(method, target).catch((err: unknown) => err)
    if (err) {
      spinner.stop("Upgrade failed", 1)
      if (err instanceof Installation.UpgradeFailedError) {
        prompts.log.error(err.data.stderr)
      } else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    spinner.stop("Upgrade complete")
    prompts.outro("Done")
  },
}
