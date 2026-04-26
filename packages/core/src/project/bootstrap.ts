import { Log } from "@liteai/util/log"
import { initializeAuthProviders } from "@/auth/registry"
import { ShareNext } from "@/share/share-next"
import { Bus } from "../bus"
import { Capabilities } from "../capabilities"
import { Command } from "../command"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Format } from "../format"
import { LSP } from "../lsp"
import { MCP } from "../mcp"
import { Plugin } from "../plugin"
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"
import { Instance } from "./instance"
import { Project } from "./project"
import { Vcs } from "./vcs"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await initializeAuthProviders()
  await Plugin.init()
  ShareNext.init()
  Format.init()
  // In hosted mode (VSCode), the IDE already runs its own language servers
  // (TypeScript, Pyright/Pylance, etc.) — spawning duplicates wastes resources.
  if (!Capabilities.isHosted()) {
    await LSP.init()
  } else {
    Log.Default.info("hosted mode — skipping LSP client engine (IDE provides language servers)")
  }
  FileWatcher.init()
  File.init()
  Vcs.init()
  Snapshot.init()
  Truncate.init()
  MCP.sync()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
