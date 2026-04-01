import * as vscode from "vscode"
import type { ServerManager } from "./server-manager"
import { WebviewBridge } from "./webview-bridge"

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "liteai.chatView"

  private _view?: vscode.WebviewView
  private _bridge?: WebviewBridge

  get view() {
    return this._view
  }
  get bridge() {
    return this._bridge
  }

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _serverManager: ServerManager,
  ) {}

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    }

    // Render the webview immediately — the SolidJS app defaults to
    // http://127.0.0.1:9000 if no URL is injected, so the panel always
    // mounts and shows the connection status indicator.
    // If we already know the URL (e.g. dev mode env var), inject it now.
    const devUrl = process.env.LITEAI_DEV_SERVER_URL
    const configUrl = vscode.workspace.getConfiguration("liteai.server").get<string>("url")
    const knownUrl = devUrl || configUrl || ""

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, knownUrl)
    this._bridge = new WebviewBridge(webviewView, this._serverManager)

    webviewView.onDidDispose(() => {
      this._bridge = undefined
    })

    // Always start the server manager — even in dev/remote mode, this sets
    // serverManager.url which the WebviewBridge needs to proxy fetch requests.
    this._serverManager.start(this._context).then(
      (url) => {
        if (this._serverManager.mode === "dev") {
          vscode.window.setStatusBarMessage(`LiteAI: Dev mode → ${url}`, 5000)
        } else if (this._serverManager.mode === "remote") {
          vscode.window.setStatusBarMessage(`LiteAI: Remote → ${url}`, 5000)
        } else {
          vscode.window.setStatusBarMessage(`LiteAI: Server started → ${url}`, 5000)
          // For production, reload with the actual URL since we didn't know it upfront
          if (this._view && !knownUrl) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview, url)
          }
        }
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        vscode.window.showErrorMessage(`LiteAI: Failed to start server — ${message}`)
      },
    )
  }

  private _getHtmlForWebview(webview: vscode.Webview, serverUrl: string) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "dist", "webview", "assets", "index.js"),
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "dist", "webview", "assets", "index.css"),
    )

    // Build CSP connect-src to allow network requests to the server
    const cspServerUrl = serverUrl || "http://127.0.0.1:* http://localhost:*"
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      // data: needed for base64-embedded fonts in the bundled CSS (woff2 data URIs)
      `font-src ${webview.cspSource} data:`,
      `img-src ${webview.cspSource} data: blob:`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
      `connect-src ${cspServerUrl} http://127.0.0.1:* http://localhost:*`,
    ].join("; ")

    // Inject the server URL. If empty, the webview entry.tsx will fall back to
    // the default dev URL (http://127.0.0.1:9000).
    // Also inject the workspace directory so the webview can derive the project ID
    // from it immediately.
    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ""
    const urlScript = [
      `<script>`,
      `  window.LITEAI_SERVER_URL = "${serverUrl}";`,
      `  window.LITEAI_WORKSPACE_DIR = ${JSON.stringify(workspaceDir)};`,
      `</script>`,
    ].join("\n")

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <title>LiteAI</title>
    <link href="${styleUri}" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    ${urlScript}
    <script type="module" src="${scriptUri}"></script>
  </body>
</html>`
  }
}
