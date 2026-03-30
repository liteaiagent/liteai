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
 * HostedCapabilities — fulfills HostCapabilities by making HTTP callbacks to
 * an Extension Server (e.g., VSCode Extension Host).
 *
 * The Extension Server runs within the IDE and provides access to live editor
 * buffers, remote filesystems (SSH/WSL/DevContainers), VSCode terminals, and
 * the Git SCM API.
 *
 * All requests carry a CSRF token in `X-CSRF-Token` header for security.
 */

class HostedFilesystem implements FilesystemCapability {
  constructor(
    private baseUrl: string,
    private csrfToken: string,
  ) {}

  private async post<T>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": this.csrfToken,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      throw new Error(`HostedCapabilities: ${endpoint} failed (${res.status}): ${await res.text()}`)
    }
    return res.json() as Promise<T>
  }

  async readFile(path: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/fs/readFile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": this.csrfToken,
      },
      body: JSON.stringify({ path }),
    })
    if (!res.ok) {
      throw new Error(`HostedCapabilities: readFile failed (${res.status}): ${await res.text()}`)
    }
    return res.text()
  }

  async readFileBytes(path: string): Promise<Buffer> {
    const res = await fetch(`${this.baseUrl}/fs/readFileBytes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": this.csrfToken,
      },
      body: JSON.stringify({ path }),
    })
    if (!res.ok) {
      throw new Error(`HostedCapabilities: readFileBytes failed (${res.status}): ${await res.text()}`)
    }
    const arrayBuffer = await res.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  async writeFile(path: string, content: string | Buffer | Uint8Array): Promise<void> {
    const body: Record<string, unknown> = { path }
    if (typeof content === "string") {
      body.content = content
      body.encoding = "utf-8"
    } else {
      body.content = Buffer.from(content).toString("base64")
      body.encoding = "base64"
    }
    await this.post("/fs/writeFile", body)
  }

  async exists(path: string): Promise<boolean> {
    const result = await this.post<{ exists: boolean }>("/fs/exists", { path })
    return result.exists
  }

  async stat(path: string): Promise<FileStat | undefined> {
    try {
      return await this.post<FileStat>("/fs/stat", { path })
    } catch {
      return undefined
    }
  }

  async readDirectory(path: string): Promise<FileEntry[]> {
    return this.post<FileEntry[]>("/fs/readDirectory", { path })
  }
}

class HostedGit implements GitCapability {
  constructor(
    private baseUrl: string,
    private csrfToken: string,
  ) {}

  async run(args: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<GitResult> {
    try {
      const res = await fetch(`${this.baseUrl}/git/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": this.csrfToken,
        },
        body: JSON.stringify({ args, cwd: opts.cwd, env: opts.env }),
      })

      if (!res.ok) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `HostedCapabilities: git/run failed (${res.status})`,
        }
      }

      return (await res.json()) as GitResult
    } catch (error) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

class HostedWorkspace implements WorkspaceCapability {
  constructor(
    private baseUrl: string,
    private csrfToken: string,
  ) {}

  async getWorkspaceFolders(): Promise<WorkspaceFolder[]> {
    const res = await fetch(`${this.baseUrl}/workspace/folders`, {
      headers: {
        "X-CSRF-Token": this.csrfToken,
      },
    })
    if (!res.ok) return []
    return (await res.json()) as WorkspaceFolder[]
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface HostedCapabilitiesOptions {
  /** URL of the Extension Server callback endpoint, e.g. `http://127.0.0.1:12345` */
  callbackUrl: string
  /** CSRF token that the Extension Server validates on every request. */
  csrfToken: string
}

/**
 * Create HostedCapabilities — delegates environment interactions to an
 * external server (the IDE's Extension Host) via HTTP.
 */
export function createHostedCapabilities(opts: HostedCapabilitiesOptions): HostCapabilities {
  const { callbackUrl, csrfToken } = opts
  return {
    hosted: true,
    fs: new HostedFilesystem(callbackUrl, csrfToken),
    git: new HostedGit(callbackUrl, csrfToken),
    workspace: new HostedWorkspace(callbackUrl, csrfToken),
  }
}
