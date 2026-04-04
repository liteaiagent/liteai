import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import * as vscode from "vscode"
import type { DiffReviewManager } from "./diff-review-manager"
import { ExtensionServer } from "./extension-server"

export type ServerMode = "production" | "remote"

export class ServerManager {
  private _url: string | null = null
  private _csrf: string | null = null
  private _process: ChildProcess | null = null
  private _readyListeners: Array<() => void> = []
  private _isReady = false
  private _mode: ServerMode = "production"
  private _extensionServer: ExtensionServer | null = null
  private _outputChannel: vscode.OutputChannel | null = null
  private readonly _diffManager: DiffReviewManager | undefined

  constructor(diffManager?: DiffReviewManager) {
    this._diffManager = diffManager
  }

  get url() {
    return this._url
  }
  get csrf() {
    return this._csrf
  }
  get mode() {
    return this._mode
  }
  /** Expose the child process so LanguageClient can attach to its stdin/stdout. */
  get process() {
    return this._process
  }
  /**
   * Register a callback to be called once the server is ready.
   * If the server is already ready, the callback fires synchronously.
   */
  onReady(cb: () => void): void {
    if (this._isReady) {
      cb()
    } else {
      this._readyListeners.push(cb)
    }
  }

  private getOutputChannel(): vscode.OutputChannel {
    if (!this._outputChannel) {
      this._outputChannel = vscode.window.createOutputChannel("LiteAI Server")
    }
    return this._outputChannel
  }

  /**
   * Start or connect to the LiteAI server.
   *
   * Resolution order:
   * 1. `liteai.server.url` VS Code setting → remote mode (connect to remote server)
   * 2. Spawn core server → production mode (with Extension Server for hosted ops)
   */
  async start(context: vscode.ExtensionContext): Promise<string> {
    const config = vscode.workspace.getConfiguration("liteai.server")
    const outputChannel = this.getOutputChannel()

    // Priority 1: Remote server URL from VS Code settings
    const remoteUrl = config.get<string>("url")
    if (remoteUrl) {
      this._mode = "remote"
      this._url = remoteUrl
      this._isReady = true
      outputChannel.appendLine(`[remote] Connecting to remote server: ${remoteUrl}`)
      return remoteUrl
    }

    // Priority 3: Spawn bundled binary in hosted mode
    this._mode = "production"

    if (this._process || this._url) {
      if (this._isReady && this._url) return this._url
      return new Promise((resolve) => {
        this._readyListeners.push(() => {
          if (this._url) resolve(this._url)
        })
      })
    }

    this._csrf = crypto.randomUUID()

    // ─── Start Extension Callback Server ──────────────────────────────
    // Core will delegate filesystem, git, and workspace operations back
    // to this server via HTTP when running in hosted mode.
    const callbackCsrfToken = crypto.randomUUID()
    this._extensionServer = new ExtensionServer({
      csrfToken: callbackCsrfToken,
      outputChannel,
      diffManager: this._diffManager,
    })
    const callbackPort = await this._extensionServer.start()
    outputChannel.appendLine(`[production] Extension callback server listening on port ${callbackPort}`)

    // ─── Spawn Core ───────────────────────────────────────────────────
    // Platform folder mapping
    const binName = process.platform === "win32" ? "liteai-core.exe" : "liteai-core"

    // In actual extension, it is placed in bin/<platform>-<arch>/
    const plat = process.platform === "win32" ? "windows" : process.platform
    const platformFolder = `${plat}-${process.arch}`

    const binPath = path.join(context.extensionPath, "bin", platformFolder, binName)

    let spawnCmd = binPath
    let spawnArgs = [
      "--hosted",
      "--port",
      context.extensionMode !== vscode.ExtensionMode.Production ? "33863" : "0",
      "--csrf-token",
      this._csrf,
      "--extension-port",
      String(callbackPort),
      "--extension-server-csrf-token",
      callbackCsrfToken,
      "--lsp",
    ]
    const spawnOpts: SpawnOptions = {
      env: { ...process.env },
      windowsHide: true,
    }

    if (context.extensionMode !== vscode.ExtensionMode.Production) {
      outputChannel.appendLine(`[dev-hosted] Overriding binPath to run 'bun dev' from packages/core`)
      spawnCmd = "bun"
      spawnArgs = ["run", "--conditions=browser", "./src/main.ts", ...spawnArgs]
      spawnOpts.cwd = path.join(context.extensionPath, "../core")
    } else {
      if (!fs.existsSync(binPath)) {
        throw new Error("CORE_MISSING")
      }
      outputChannel.appendLine(`[production] Spawning local server: ${binPath}`)
    }

    outputChannel.appendLine(`[spawn] Command: ${spawnCmd} ${spawnArgs.join(" ")}`)
    this._process = spawn(spawnCmd, spawnArgs, spawnOpts)

    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout

      // With --lsp active, core writes the listen message to stderr (stdout is LSP JSON-RPC).
      // We parse the ready URL from stderr. All other stderr content is also logged.
      const onStderr = (data: Buffer) => {
        const text = data.toString()
        outputChannel.append(text)

        // Look for: "liteai core server listening on http://127.0.0.1:XXXXX"
        const match = text.match(/listening on (http:\/\/[^\s]+)/)
        if (match) {
          this._url = match[1]
          this._isReady = true
          clearTimeout(timeoutId)

          // Register workspace folders now that Core is ready
          this.registerWorkspaceFolders().catch((err) => {
            outputChannel.appendLine(`[production] Workspace registration warning: ${err}`)
          })

          resolve(this._url)
          this._readyListeners.forEach((cb) => {
            cb()
          })
          this._readyListeners = []
        }
      }

      const onStdout = (data: Buffer) => {
        // stdout is owned by LSP JSON-RPC when --lsp is active — do NOT log or parse it here.
        // Without --lsp it would contain the listen message, but we always use --lsp now.
        // Log only for debugging purposes at trace level if needed.
        void data
      }

      this._process?.stdout?.on("data", onStdout)
      this._process?.stderr?.on("data", onStderr)

      this._process?.on("error", (err) => {
        clearTimeout(timeoutId)
        outputChannel.appendLine(`Error spawning server: ${err.message}`)
        reject(err)
      })

      this._process?.on("exit", (code) => {
        clearTimeout(timeoutId)
        outputChannel.appendLine(`Server exited with code ${code}`)
        this._process = null
        this._isReady = false

        // If it exited before we ever saw the 'listening on' message,
        // reject so the user isn't forced to wait for a 30s timeout.
        if (!this._url) {
          reject(
            new Error(
              `Server exited prematurely with code ${code}. Check the "LiteAI Server" output channel for details.`,
            ),
          )
        }
      })

      timeoutId = setTimeout(() => {
        reject(new Error("Timeout waiting for LiteAI server to start"))
      }, 30000)
    })
  }

  // ─── Workspace Registration (Task 3.4) ────────────────────────────────────

  /**
   * Push all current workspace folders to Core via POST /project?directory=...
   * This eliminates the "Project not found in registry" error.
   */
  async registerWorkspaceFolders(): Promise<void> {
    if (!this._url || !this._csrf) return

    const folders = vscode.workspace.workspaceFolders ?? []
    const outputChannel = this.getOutputChannel()

    for (const folder of folders) {
      try {
        await this.registerOneFolder(folder.uri.fsPath)
        outputChannel.appendLine(`[hosted] Registered workspace folder: ${folder.uri.fsPath}`)
      } catch (err) {
        outputChannel.appendLine(
          `[hosted] Failed to register folder ${folder.uri.fsPath}: ${err instanceof Error ? err.message : err}`,
        )
      }
    }
  }

  /**
   * Register a single workspace folder with Core.
   * Public so extension.ts can call it from onDidChangeWorkspaceFolders.
   */
  async registerOneFolder(directory: string): Promise<void> {
    if (!this._url || !this._csrf) return

    const url = new URL("/project", this._url)
    url.searchParams.set("directory", directory)

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this._csrf}`,
      },
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`HTTP ${response.status}: ${text}`)
    }
  }

  dispose() {
    // Stop Extension Callback Server
    if (this._extensionServer) {
      this._extensionServer.dispose()
      this._extensionServer = null
    }

    // Stop Core process
    if (this._process) {
      this._process.kill("SIGTERM")
      setTimeout(() => {
        if (this._process && !this._process.killed) {
          this._process.kill("SIGKILL")
        }
      }, 3000)
    }
  }
}
