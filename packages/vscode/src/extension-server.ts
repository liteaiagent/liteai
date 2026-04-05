import * as child_process from "node:child_process"
import * as http from "node:http"
import * as vscode from "vscode"
import type { DiffReviewManager } from "./diff-review-manager"

/**
 * ExtensionServer — HTTP callback server running in the VSCode Extension Host.
 *
 * When Core is spawned with `--hosted`, it delegates filesystem, git, and
 * workspace operations back to this server via HTTP. This enables Core to:
 * - Read unsaved editor buffer content (not just stale disk files)
 * - Work over Remote SSH / WSL / DevContainers via `vscode.workspace.fs`
 * - Query the IDE's workspace folders (eliminating "Project not found" errors)
 * - Run git commands in the correct environment
 *
 * All incoming requests are validated against a CSRF token that Core receives
 * at startup via `--callback-csrf-token`.
 */

const LOG_PREFIX = "[ExtensionServer]"

export class ExtensionServer {
  private _server: http.Server | undefined
  private _port = 0
  private readonly _csrfToken: string
  private readonly _outputChannel: vscode.OutputChannel
  private readonly _diffManager: DiffReviewManager | undefined

  get port() {
    return this._port
  }
  get csrfToken() {
    return this._csrfToken
  }

  constructor(opts: { csrfToken: string; outputChannel: vscode.OutputChannel; diffManager?: DiffReviewManager }) {
    this._csrfToken = opts.csrfToken
    this._outputChannel = opts.outputChannel
    this._diffManager = opts.diffManager
  }

  private log(msg: string) {
    this._outputChannel.appendLine(`${LOG_PREFIX} ${msg}`)
  }

  /** Start listening on a random available port. Returns the assigned port. */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.log(`Unhandled error: ${err}`)
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ error: "Internal server error" }))
          }
        })
      })

      this._server.listen(0, "127.0.0.1", () => {
        const addr = this._server?.address() as { port: number }
        this._port = addr.port
        this.log(`Listening on http://127.0.0.1:${this._port}`)
        resolve(this._port)
      })

      this._server.on("error", (err) => {
        this.log(`Server error: ${err.message}`)
        reject(err)
      })
    })
  }

  // ─── Request routing ────────────────────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // CSRF validation — Core sends the token in X-CSRF-Token header
    const token = req.headers["x-csrf-token"]
    if (token !== this._csrfToken) {
      res.writeHead(403, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Forbidden: invalid CSRF token" }))
      return
    }

    const url = req.url || "/"
    let body: Record<string, unknown> = {}
    if (req.method === "POST") {
      body = await this.readBody(req)
    }

    try {
      switch (url) {
        // Filesystem
        case "/fs/readFile":
          return await this.fsReadFile(body, res)
        case "/fs/readFileBytes":
          return await this.fsReadFileBytes(body, res)
        case "/fs/writeFile":
          return await this.fsWriteFile(body, res)
        case "/fs/exists":
          return await this.fsExists(body, res)
        case "/fs/stat":
          return await this.fsStat(body, res)
        case "/fs/readDirectory":
          return await this.fsReadDirectory(body, res)
        // Git
        case "/git/run":
          return await this.gitRun(body, res)
        // Workspace
        case "/workspace/folders":
          return this.workspaceFolders(res)
        default:
          res.writeHead(404, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: `Unknown route: ${url}` }))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.log(`Error handling ${req.method} ${url}: ${msg}`)
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: msg }))
      }
    }
  }

  // ─── Body parsing ──────────────────────────────────────────────────────────

  private readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on("data", (chunk: Buffer) => chunks.push(chunk))
      req.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf-8")
          resolve(raw ? JSON.parse(raw) : {})
        } catch {
          resolve({})
        }
      })
      req.on("error", reject)
    })
  }

  // ─── Response helpers ──────────────────────────────────────────────────────

  private sendJson(res: http.ServerResponse, data: unknown, status = 200) {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(data))
  }

  private sendText(res: http.ServerResponse, data: string, status = 200) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" })
    res.end(data)
  }

  private sendBinary(res: http.ServerResponse, data: Uint8Array, status = 200) {
    res.writeHead(status, {
      "Content-Type": "application/octet-stream",
      "Content-Length": data.byteLength.toString(),
    })
    res.end(Buffer.from(data))
  }

  // ─── Filesystem handlers ──────────────────────────────────────────────────

  /**
   * POST /fs/readFile — the most critical endpoint.
   *
   * Checks for unsaved (dirty) editor buffers first, then falls back to
   * `vscode.workspace.fs.readFile()` which works transparently over
   * Remote SSH / WSL / DevContainers.
   */
  private async fsReadFile(body: Record<string, unknown>, res: http.ServerResponse) {
    const filePath = body.path as string
    if (!filePath) return this.sendJson(res, { error: "Missing 'path'" }, 400)

    const uri = vscode.Uri.file(filePath)

    // Check for unsaved (dirty) editor buffer first
    const openDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === uri.fsPath)
    if (openDoc) {
      return this.sendText(res, openDoc.getText())
    }

    // Fall back to filesystem
    const content = await vscode.workspace.fs.readFile(uri)
    return this.sendText(res, new TextDecoder().decode(content))
  }

  /** POST /fs/readFileBytes — binary file read. */
  private async fsReadFileBytes(body: Record<string, unknown>, res: http.ServerResponse) {
    const filePath = body.path as string
    if (!filePath) return this.sendJson(res, { error: "Missing 'path'" }, 400)

    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
    return this.sendBinary(res, content)
  }

  /** POST /fs/writeFile — write content to a file. Supports UTF-8 and base64 encoding. */
  private async fsWriteFile(body: Record<string, unknown>, res: http.ServerResponse) {
    const filePath = body.path as string
    if (!filePath) return this.sendJson(res, { error: "Missing 'path'" }, 400)

    const encoding = (body.encoding as string) || "utf-8"
    const rawContent = body.content as string

    // Capture pre-edit content for diff tracking (before writing)
    let oldContent: string | undefined
    if (this._diffManager && encoding !== "base64") {
      try {
        const uri = vscode.Uri.file(filePath)
        const openDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === uri.fsPath)
        if (openDoc) {
          oldContent = openDoc.getText()
        } else {
          const existing = await vscode.workspace.fs.readFile(uri)
          oldContent = new TextDecoder().decode(existing)
        }
      } catch {
        // File doesn't exist yet (new file creation) — oldContent stays undefined
      }
    }

    let bytes: Uint8Array
    if (encoding === "base64") {
      bytes = Buffer.from(rawContent, "base64")
    } else {
      bytes = new TextEncoder().encode(rawContent)
    }

    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), bytes)
    this.sendJson(res, { ok: true })

    // Open the edited file in the editor so the user can see changes (non-blocking)
    if (encoding !== "base64") {
      vscode.workspace.openTextDocument(vscode.Uri.file(filePath)).then(
        (doc) => vscode.window.showTextDocument(doc, { preserveFocus: true, preview: true }),
        () => {}, // ignore errors (e.g. binary files)
      )
    }

    // Track the edit for inline diff decorations (non-blocking, after response)
    if (this._diffManager && oldContent !== undefined && encoding !== "base64") {
      this._diffManager.trackEdit(filePath, oldContent, rawContent)
    }
  }

  /** POST /fs/exists — check whether a path exists. */
  private async fsExists(body: Record<string, unknown>, res: http.ServerResponse) {
    const filePath = body.path as string
    if (!filePath) return this.sendJson(res, { error: "Missing 'path'" }, 400)

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
      this.sendJson(res, { exists: true })
    } catch {
      this.sendJson(res, { exists: false })
    }
  }

  /** POST /fs/stat — get file/directory metadata. */
  private async fsStat(body: Record<string, unknown>, res: http.ServerResponse) {
    const filePath = body.path as string
    if (!filePath) return this.sendJson(res, { error: "Missing 'path'" }, 400)

    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
    this.sendJson(res, {
      isFile: (stat.type & vscode.FileType.File) !== 0,
      isDirectory: (stat.type & vscode.FileType.Directory) !== 0,
      size: stat.size,
      mtimeMs: stat.mtime,
    })
  }

  /** POST /fs/readDirectory — list entries in a directory. */
  private async fsReadDirectory(body: Record<string, unknown>, res: http.ServerResponse) {
    const dirPath = body.path as string
    if (!dirPath) return this.sendJson(res, { error: "Missing 'path'" }, 400)

    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath))
    const result = entries.map(([name, type]) => ({
      name,
      isDirectory: (type & vscode.FileType.Directory) !== 0,
    }))
    this.sendJson(res, result)
  }

  // ─── Git handler ───────────────────────────────────────────────────────────

  /**
   * POST /git/run — execute a git command.
   *
   * Uses `child_process.execFile("git", args, { cwd })`. In VSCode Remote
   * environments, the Extension Host runs on the remote machine, so this
   * spawns git in the correct environment.
   */
  private gitRun(body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
    const args = body.args as string[]
    const cwd = body.cwd as string
    const env = body.env as Record<string, string> | undefined

    if (!args || !cwd) {
      this.sendJson(res, { error: "Missing 'args' or 'cwd'" }, 400)
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      child_process.execFile(
        "git",
        args,
        {
          cwd,
          env: env ? { ...process.env, ...env } : process.env,
          maxBuffer: 10 * 1024 * 1024, // 10 MB
          timeout: 30_000, // 30s
        },
        (error, stdout, stderr) => {
          const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0
          this.sendJson(res, {
            exitCode,
            stdout: stdout || "",
            stderr: stderr || (error ? error.message : ""),
          })
          resolve()
        },
      )
    })
  }

  // ─── Workspace handler ─────────────────────────────────────────────────────

  /** GET /workspace/folders — list active VSCode workspace folders. */
  private workspaceFolders(res: http.ServerResponse) {
    const folders = vscode.workspace.workspaceFolders ?? []
    this.sendJson(
      res,
      folders.map((f) => ({ path: f.uri.fsPath, name: f.name })),
    )
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  dispose() {
    if (this._server) {
      this._server.close()
      this._server = undefined
      this.log("Server stopped")
    }
  }
}
