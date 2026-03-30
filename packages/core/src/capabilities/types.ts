/**
 * HostCapabilities — abstraction layer for environment interactions.
 *
 * Core services use these interfaces instead of direct `node:fs`, `child_process`,
 * and SQLite calls. This enables two modes:
 *
 * - **Local** (default): Delegates to the current Node.js implementations.
 * - **Hosted** (`--hosted`): Delegates filesystem, git, and workspace operations
 *   back to the IDE (VSCode) via HTTP callbacks.
 *
 * @see LocalCapabilities — wraps existing Filesystem + git() for standalone mode.
 * @see HostedCapabilities — makes HTTP callbacks to an Extension Server.
 */

// ─── Filesystem ──────────────────────────────────────────────────────────────

export interface FileStat {
  isFile: boolean
  isDirectory: boolean
  size: number
  mtimeMs?: number
}

export interface FileEntry {
  name: string
  isDirectory: boolean
}

export interface FilesystemCapability {
  /** Read a file as UTF-8 text. In hosted mode, returns unsaved editor buffer content. */
  readFile(path: string): Promise<string>

  /** Read a file as binary Buffer. */
  readFileBytes(path: string): Promise<Buffer>

  /** Write content to a file, creating parent directories as needed. */
  writeFile(path: string, content: string | Buffer | Uint8Array): Promise<void>

  /** Check whether a file or directory exists. */
  exists(path: string): Promise<boolean>

  /** Get file/directory metadata. Returns undefined if path doesn't exist. */
  stat(path: string): Promise<FileStat | undefined>

  /** List entries in a directory. */
  readDirectory(path: string): Promise<FileEntry[]>
}

// ─── Git / VCS ───────────────────────────────────────────────────────────────

export interface GitResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface GitCapability {
  /** Run a git command and return the result. */
  run(args: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<GitResult>
}

// ─── Workspace ───────────────────────────────────────────────────────────────

export interface WorkspaceFolder {
  /** Absolute path to the workspace folder root. */
  path: string
  /** Display name for the folder. */
  name?: string
}

export interface WorkspaceCapability {
  /** List active workspace folders from the host IDE. */
  getWorkspaceFolders(): Promise<WorkspaceFolder[]>
}

// ─── Composite ───────────────────────────────────────────────────────────────

/**
 * Full HostCapabilities interface — the union of all capability domains.
 *
 * Core reads this from the global capabilities context. The startup path
 * (`main.ts`) decides which implementation to install based on `--hosted`.
 */
export interface HostCapabilities {
  /** Whether this is running in hosted mode (IDE is the environment owner). */
  readonly hosted: boolean

  /** Filesystem operations. */
  readonly fs: FilesystemCapability

  /** Git command execution. */
  readonly git: GitCapability

  /** IDE workspace state. */
  readonly workspace: WorkspaceCapability
}
