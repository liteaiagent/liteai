import { existsSync, readdirSync, statSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Process } from "../util/process"
import type {
  FileEntry,
  FileStat,
  FilesystemCapability,
  GitCapability,
  GitResult,
  HostCapabilities,
  WorkspaceCapability,
  WorkspaceFolder,
} from "./types"

/**
 * LocalCapabilities — wraps the existing Node.js filesystem, git CLI, and
 * workspace resolution into the HostCapabilities interface.
 *
 * **This is a pure refactor — identical behavior to the current codebase.**
 * All existing `Filesystem.*` and `git()` calls delegate here when running
 * in local (non-hosted) mode.
 */

// ─── Filesystem ──────────────────────────────────────────────────────────────

class LocalFilesystem implements FilesystemCapability {
  async readFile(path: string): Promise<string> {
    return readFile(path, "utf-8")
  }

  async readFileBytes(path: string): Promise<Buffer> {
    return readFile(path)
  }

  async writeFile(path: string, content: string | Buffer | Uint8Array): Promise<void> {
    try {
      await writeFile(path, content)
    } catch (e) {
      if (isEnoent(e)) {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content)
        return
      }
      throw e
    }
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(path)
  }

  async stat(path: string): Promise<FileStat | undefined> {
    try {
      const s = statSync(path, { throwIfNoEntry: false })
      if (!s) return undefined
      return {
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        size: typeof s.size === "bigint" ? Number(s.size) : s.size,
        mtimeMs: s.mtimeMs,
      }
    } catch {
      return undefined
    }
  }

  async readDirectory(path: string): Promise<FileEntry[]> {
    try {
      const entries = readdirSync(path, { withFileTypes: true })
      return entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }))
    } catch {
      return []
    }
  }
}

// ─── Git ─────────────────────────────────────────────────────────────────────

class LocalGit implements GitCapability {
  async run(args: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<GitResult> {
    try {
      const result = await Process.run(["git", ...args], {
        cwd: opts.cwd,
        env: opts.env,
        stdin: "ignore",
        nothrow: true,
      })
      return {
        exitCode: result.code,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      }
    } catch (error) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

// ─── Workspace ───────────────────────────────────────────────────────────────

class LocalWorkspace implements WorkspaceCapability {
  /**
   * In local mode, workspace folders aren't externally managed — Core owns
   * the project registry in SQLite. Returns an empty list because workspace
   * folder discovery is handled by Project.resolve() + Database.
   */
  async getWorkspaceFolders(): Promise<WorkspaceFolder[]> {
    return []
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

function isEnoent(e: unknown): e is { code: "ENOENT" } {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ENOENT"
}

/**
 * Create LocalCapabilities — the default implementation that wraps
 * the existing Node.js filesystem and git CLI.
 */
export function createLocalCapabilities(): HostCapabilities {
  return {
    hosted: false,
    fs: new LocalFilesystem(),
    git: new LocalGit(),
    workspace: new LocalWorkspace(),
  }
}
