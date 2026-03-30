import { type ChildProcess, spawn } from "node:child_process"
import * as crypto from "node:crypto"
import * as path from "node:path"
import * as vscode from "vscode"

export class ServerManager {
  private _url: string | null = null
  private _csrf: string | null = null
  private _process: ChildProcess | null = null
  private _readyListeners: Array<() => void> = []
  private _isReady = false

  get url() {
    return this._url
  }
  get csrf() {
    return this._csrf
  }

  async start(context: vscode.ExtensionContext): Promise<string> {
    const config = vscode.workspace.getConfiguration("liteai.server")
    const remoteUrl = process.env.LITEAI_DEV_SERVER_URL || config.get<string>("url")
    if (remoteUrl) {
      this._url = remoteUrl
      this._isReady = true
      return remoteUrl
    }

    if (this._process || this._url) {
      if (this._isReady && this._url) return this._url
      return new Promise((resolve) => {
        this._readyListeners.push(() => {
          if (this._url) resolve(this._url)
        })
      })
    }

    this._csrf = crypto.randomUUID()

    // Platform folder mapping
    const binName = process.platform === "win32" ? "liteai-core.exe" : "liteai-core"

    // In actual extension, it is placed in bin/<platform>-<arch>/
    const plat = process.platform === "win32" ? "windows" : process.platform
    const platformFolder = `${plat}-${process.arch}`

    const binPath = path.join(context.extensionPath, "bin", platformFolder, binName)

    const outputChannel = vscode.window.createOutputChannel("LiteAI Server")
    outputChannel.appendLine(`Spawning local server: ${binPath}`)

    this._process = spawn(binPath, ["--port", "0", "--csrf-token", this._csrf], {
      env: { ...process.env },
      windowsHide: true,
    })

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

  dispose() {
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
