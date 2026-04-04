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

    this._bridge = new WebviewBridge(webviewView, this._serverManager)

    webviewView.onDidDispose(() => {
      this._bridge = undefined
    })

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === "retry-core-launch") {
        this._startServerAndLoad()
      }
    })

    this._startServerAndLoad()
  }

  private _startServerAndLoad() {
    if (!this._view) return
    const webview = this._view.webview

    // Show loading state initially
    webview.html = this._getLoadingHtml()

    this._serverManager.start(this._context).then(
      (url) => {
        if (this._serverManager.mode === "remote") {
          vscode.window.setStatusBarMessage(`LiteAI: Remote → ${url}`, 5000)
        } else {
          vscode.window.setStatusBarMessage(`LiteAI: Server started → ${url}`, 5000)
        }
        if (this._view) {
          this._view.webview.html = this._getHtmlForWebview(this._view.webview, url)
        }
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        vscode.window.showErrorMessage(`LiteAI: Failed to start server — ${message}`)
        if (this._view) {
          this._view.webview.html = this._getErrorHtml(message)
        }
      },
    )
  }

  private _getLoadingHtml() {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LiteAI</title>
    <style>
      .initial-loader {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        width: 100vw;
        background-color: var(--vscode-sideBar-background, #101010);
        font-family: var(--vscode-font-family, "Inter", sans-serif);
        font-size: 13px;
        user-select: none;
      }
      .shimmer-text {
        color: rgba(255, 255, 255, 0.2);
        background: linear-gradient(90deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.2) 100%);
        background-size: 200% auto;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: shimmer 1.5s linear infinite;
      }
      body.vscode-light .shimmer-text {
        color: rgba(0, 0, 0, 0.2);
        background: linear-gradient(90deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.8) 50%, rgba(0,0,0,0.2) 100%);
        background-size: 200% auto;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      @keyframes shimmer {
        to { background-position: 200% center; }
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div class="initial-loader">
        <span class="shimmer-text">Connecting to Server...</span>
      </div>
    </div>
  </body>
</html>`
  }

  private _getErrorHtml(errorMsg: string) {
    const isMissing = errorMsg.includes("CORE_MISSING")
    
    const title = isMissing ? "Installation Error" : "Connection Error"
    const message = isMissing 
      ? "LiteAI core server is missing. Please uninstall and reinstall the extension."
      : "Failed to connect to the LiteAI server."
      
    // Provide a button to retry except for missing core
    const buttonHtml = isMissing 
       ? `` 
       : `<button onclick="retry()">Refresh & Retry</button>`

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LiteAI Error</title>
    <style>
      body {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        width: 100vw;
        background-color: var(--vscode-sideBar-background, #101010);
        color: var(--vscode-foreground, #cccccc);
        font-family: var(--vscode-font-family, "Inter", sans-serif);
        font-size: 13px;
        text-align: center;
        padding: 20px;
        box-sizing: border-box;
      }
      h2 { margin-bottom: 8px; font-weight: 500; }
      p { margin-bottom: 16px; opacity: 0.8; }
      .details {
        background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.1));
        padding: 8px 12px;
        border-radius: 4px;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 12px;
        margin-bottom: 24px;
        max-width: 100%;
        overflow-x: auto;
        opacity: 0.7;
      }
      button {
        background: var(--vscode-button-background, #007acc);
        color: var(--vscode-button-foreground, #ffffff);
        border: none;
        padding: 8px 16px;
        border-radius: 2px;
        cursor: pointer;
        font-size: 13px;
        font-family: inherit;
      }
      button:hover { background: var(--vscode-button-hoverBackground, #005f9e); }
    </style>
  </head>
  <body>
    <h2>${title}</h2>
    <p>${message}</p>
    ${!isMissing ? `<div class="details">${errorMsg}</div>` : ''}
    ${buttonHtml}
    
    <script>
      const vscode = acquireVsCodeApi();
      function retry() {
        vscode.postMessage({ type: "retry-core-launch" });
      }
    </script>
  </body>
</html>`
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
      `script-src ${webview.cspSource} 'unsafe-inline' 'wasm-unsafe-eval'`,
      // worker-src needed for pierre/diffs syntax highlighting workers
      `worker-src ${webview.cspSource} blob:`,
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
    <style>
      .initial-loader {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        width: 100vw;
        background-color: var(--vscode-sideBar-background, #101010);
        font-family: var(--vscode-font-family, "Inter", sans-serif);
        font-size: 13px;
        user-select: none;
      }
      .shimmer-text {
        color: rgba(255, 255, 255, 0.2);
        background: linear-gradient(90deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.2) 100%);
        background-size: 200% auto;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: shimmer 1.5s linear infinite;
      }
      body.vscode-light .shimmer-text {
        color: rgba(0, 0, 0, 0.2);
        background: linear-gradient(90deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.8) 50%, rgba(0,0,0,0.2) 100%);
        background-size: 200% auto;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      @keyframes shimmer {
        to { background-position: 200% center; }
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div class="initial-loader">
        <span class="shimmer-text">Loading...</span>
      </div>
    </div>
    ${urlScript}
    <script type="module" src="${scriptUri}"></script>
  </body>
</html>`
  }
}
