import os from "node:os"
import path from "node:path"
import { Fs as Filesystem } from "@liteai/util/fs"

const OUTPUT_DIR = path.join(os.tmpdir(), "liteai-output")

/**
 * Write large tool output to a local temp file, organised by session.
 *
 * Uses `Filesystem.write` which auto-creates parent directories on ENOENT,
 * so we don't need a separate mkdir call.
 *
 * @returns The absolute path to the written file.
 */
export async function writeOutputFile(opts: { sessionID: string; callID: string; content: string }): Promise<string> {
  const file = path.join(OUTPUT_DIR, opts.sessionID, `${opts.callID}.txt`)
  await Filesystem.write(file, opts.content)
  return file
}

/**
 * Shorten a path for display purposes.
 * - Replaces the user's home directory with `~`
 * - Falls back to the absolute path if home detection fails
 */
export function shortenPath(filePath: string): string {
  const home = os.homedir()
  if (filePath.startsWith(home)) {
    return filePath.replace(home, "~")
  }
  return filePath
}
