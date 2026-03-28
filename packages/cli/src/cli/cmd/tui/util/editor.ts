import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defer } from "@liteai/core/util/defer"
import { Filesystem } from "@liteai/core/util/filesystem"
import { Process } from "@liteai/core/util/process"
import type { CliRenderer } from "@opentui/core"

export namespace Editor {
  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
    const editor = process.env.VISUAL || process.env.EDITOR
    if (!editor) return

    const filepath = join(tmpdir(), `${Date.now()}.md`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Filesystem.write(filepath, opts.value)
    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()
    const parts = editor.split(" ")
    const proc = Process.spawn([...parts, filepath], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    await proc.exited
    const content = await Filesystem.readText(filepath)
    opts.renderer.currentRenderBuffer.clear()
    opts.renderer.resume()
    opts.renderer.requestRender()
    return content || undefined
  }
}
