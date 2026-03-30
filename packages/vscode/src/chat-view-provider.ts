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

    try {
      const url = await this._serverManager.start(this._context)
      webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, url)
      this._bridge = new WebviewBridge(webviewView, this._serverManager)

      webviewView.onDidDispose(() => {
        this._bridge = undefined
      })
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to start server: ${e?.message}`)
      webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, "")
      this._bridge = new WebviewBridge(webviewView, this._serverManager)
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview, serverUrl: string) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "dist", "webview", "assets", "index.js"),
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "dist", "webview", "assets", "index.css"),
    )

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LiteAI</title>
    <link href="${styleUri}" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script>window.LITEAI_SERVER_URL = "${serverUrl}"</script>
    <!-- We will use Vite out with specific hashes so we should adapt to dynamic inject or just generic names -->
    <script type="module" src="${scriptUri}"></script>
  </body>
</html>`
  }
}
