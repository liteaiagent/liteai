import { Flag } from "@liteai/core/flag/flag"
import { Instance } from "@liteai/core/project/instance"
import { Server } from "@liteai/core/server/server"
import { Log } from "@liteai/core/util/log"
import { resolveNetworkOptions, withNetworkOptions } from "../network"
import { cmd } from "./cmd"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless liteai server",
  handler: async (args) => {
    if (!Flag.LITEAI_SERVER_PASSWORD) {
      console.log("Warning: LITEAI_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`liteai server listening on http://${server.hostname}:${server.port}`)

    await new Promise<void>((resolve) => {
      for (const signal of ["SIGTERM", "SIGINT"] as const) {
        process.on(signal, () => {
          Log.Default.info("serve received signal, shutting down", { signal })
          resolve()
        })
      }
    })
    await Instance.disposeAll()
    await server.stop(true)
  },
})
