import * as vscode from "vscode"
import type { ServerManager } from "./server-manager"

export class WebviewBridge {
  constructor(
    private readonly panel: vscode.WebviewView,
    private readonly serverManager: ServerManager,
  ) {
    this.panel.webview.onDidReceiveMessage(this.onMessage.bind(this))
  }

  /**
   * Wait for the server URL to become available (handles race with
   * serverManager.start() which runs in parallel with webview mount).
   */
  private async waitForUrl(timeoutMs = 5000): Promise<string> {
    if (this.serverManager.url) return this.serverManager.url
    const start = Date.now()
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.serverManager.url) {
          resolve(this.serverManager.url)
          return
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Server URL not available (timeout)"))
          return
        }
        setTimeout(check, 50)
      }
      check()
    })
  }

  // biome-ignore lint/suspicious/noExplicitAny: VS Code webview messages are untyped
  async onMessage(msg: any) {
    if (msg.type === "vscode-command") {
      if (msg.command === "openLink") {
        if (msg.args?.url === "liteai://webview-ready") return
        vscode.env.openExternal(vscode.Uri.parse(msg.args.url))
      } else if (msg.command === "openFile") {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.args.path))
        vscode.window.showTextDocument(doc)
      } else if (msg.command === "notify") {
        vscode.window.showInformationMessage(msg.args.title)
      }
      return
    }

    if (msg.type === "fetch") {
      try {
        const baseUrl = await this.waitForUrl()
        const url = new URL(msg.url, baseUrl)
        const headers = new Headers(msg.headers || {})
        if (this.serverManager.csrf) {
          headers.set("Authorization", `Bearer ${this.serverManager.csrf}`)
        }

        const response = await fetch(url.toString(), {
          method: msg.method,
          headers,
          body: msg.body,
        })

        const contentType = response.headers.get("content-type") || ""

        if (contentType.includes("text/event-stream") && response.body) {
          // SSE streaming
          this.panel.webview.postMessage({
            type: "fetch-response",
            id: msg.id,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
          })

          const reader = response.body.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              this.panel.webview.postMessage({
                type: "fetch-chunk",
                id: msg.id,
                done: true,
              })
              break
            }
            this.panel.webview.postMessage({
              type: "fetch-chunk",
              id: msg.id,
              chunk: Array.from(value), // converting Uint8Array to array of numbers for sending over postMessage
            })
          }
        } else {
          // Regular request
          const arrayBuffer = await response.arrayBuffer()
          this.panel.webview.postMessage({
            type: "fetch-response",
            id: msg.id,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: Array.from(new Uint8Array(arrayBuffer)),
          })
        }
      } catch (e: unknown) {
        this.panel.webview.postMessage({
          type: "fetch-response",
          id: msg.id,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  dispose() {
    // any cleanup
  }
}
