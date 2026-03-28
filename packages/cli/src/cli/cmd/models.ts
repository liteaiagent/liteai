import { EOL } from "node:os"
import { Instance } from "@liteai/core/project/instance"
import { ModelsDev } from "@liteai/core/provider/models"
import { Provider } from "@liteai/core/provider/provider"
import { ProviderID } from "@liteai/core/provider/schema"
import type { Argv } from "yargs"
import { UI } from "../ui"
import { cmd } from "./cmd"

export const ModelsCommand = cmd({
  command: "models [provider]",
  describe: "list all available models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      })
  },
  handler: async (args) => {
    if (args.refresh) {
      await ModelsDev.refresh()
      UI.println(`${UI.Style.TEXT_SUCCESS_BOLD}Models cache refreshed${UI.Style.TEXT_NORMAL}`)
    }

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const providers = await Provider.list()

        function printModels(providerID: ProviderID, verbose?: boolean) {
          const provider = providers[providerID]
          const sortedModels = Object.entries(provider.models).sort(([a], [b]) => a.localeCompare(b))
          for (const [modelID, model] of sortedModels) {
            process.stdout.write(`${providerID}/${modelID}`)
            process.stdout.write(EOL)
            if (verbose) {
              process.stdout.write(JSON.stringify(model, null, 2))
              process.stdout.write(EOL)
            }
          }
        }

        if (args.provider) {
          const provider = providers[args.provider]
          if (!provider) {
            UI.error(`Provider not found: ${args.provider}`)
            return
          }

          printModels(ProviderID.make(args.provider), args.verbose)
          return
        }

        const providerIDs = Object.keys(providers).sort((a, b) => {
          const aIsCodeAssist = a.startsWith("google-code-assist")
          const bIsCodeAssist = b.startsWith("google-code-assist")
          if (aIsCodeAssist && !bIsCodeAssist) return -1
          if (!bIsCodeAssist && aIsCodeAssist) return 1
          return a.localeCompare(b)
        })

        for (const providerID of providerIDs) {
          printModels(ProviderID.make(providerID), args.verbose)
        }
      },
    })
  },
})
