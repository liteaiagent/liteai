import { type ChildProcess, spawn, type SpawnOptions } from "node:child_process"
import * as crypto from "node:crypto"
import * as path from "node:path"
import * as vscode from "vscode"
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

  get url() {
    return this._url
  }
  get csrf() {
    return this._csrf
  }
  get mode() {
    return this._mode
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
      "0",
      "--csrf-token",
      this._csrf,
      "--extension-port",
      String(callbackPort),
      "--extension-server-csrf-token",
      callbackCsrfToken,
    ]
    let spawnOpts: SpawnOptions = {
      env: { ...process.env },
      windowsHide: true,
    }

    if (__LITEAI_DEV__) {
      if (process.env.LITEAI_SPAWN_DEV_SERVER === "true") {
        outputChannel.appendLine(`[dev-hosted] Overriding binPath to run 'bun dev' from packages/core`)
        spawnCmd = "bun"
        spawnArgs = [
          "--watch", "run", "--conditions=browser", "./src/main.ts",
          ...spawnArgs
        ]
        spawnOpts.cwd = path.join(context.extensionPath, "../core")
      } else {
        outputChannel.appendLine(`[production] Spawning local server: ${binPath}`)
      }
    } else {
      outputChannel.appendLine(`[production] Spawning local server: ${binPath}`)
    }

    this._process = spawn(spawnCmd, spawnArgs, spawnOpts)

    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout

      const onStdout = (data: Buffer) => {
        const text = data.toString()
        outputChannel.append(text)

        // Look for: "listening on http://127.0.0.1:XXXXX" or "listening on http://localhost:XXXXX"
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

      const onStderr = (data: Buffer) => {
        outputChannel.append(data.toString())
      }

      this._process?.stdout?.on("data", onStdout)
      this._process?.stderr?.on("data", onStderr)

      this._process?.on("error", (err) => {
        outputChannel.appendLine(`Error spawning server: ${err.message}`)
        reject(err)
      })

      this._process?.on("exit", (code) => {
        outputChannel.appendLine(`Server exited with code ${code}`)
        this._process = null
        this._isReady = false
      })

      timeoutId = setTimeout(() => {
        reject(new Error("Timeout waiting for LiteAI server to start"))
      }, 10000)
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
