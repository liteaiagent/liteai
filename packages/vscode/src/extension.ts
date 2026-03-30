import * as vscode from "vscode"
import { ChatViewProvider } from "./chat-view-provider"
import { ServerManager } from "./server-manager"

const TERMINAL_NAME = "liteai"
let serverManager: ServerManager

export function deactivate() {
  if (serverManager) {
    serverManager.dispose()
  }
}

export function activate(context: vscode.ExtensionContext) {
  serverManager = new ServerManager()

  const provider = new ChatViewProvider(context, serverManager)
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider))

  const _openNewTerminalDisposable = vscode.commands.registerCommand("liteai.openNewTerminal", async () => {
    await openTerminal()
  })

  const openTerminalDisposable = vscode.commands.registerCommand("liteai.openTerminal", async () => {
    // A liteai terminal already exists => focus it
    const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existing) {
      existing.show()
      return
    }

    await openTerminal()
  })

  const addFilepathDisposable = vscode.commands.registerCommand("liteai.addFilepathToTerminal", async () => {
    const ref = getActiveFile()
    if (!ref) {
      return
    }

    const terminal = vscode.window.activeTerminal
    if (!terminal) {
      return
    }

    if (terminal.name === TERMINAL_NAME) {
      // @ts-expect-error
      const port = terminal.creationOptions.env?._EXTENSION_LITEAI_PORT
      port ? await appendPrompt(parseInt(port, 10), ref) : terminal.sendText(ref, false)
      terminal.show()
    }
  })

  // Start the server manager (it will connect to remote or wait until explicitly told)
  // We provide the extension context. Note: ChatViewProvider will tell it to start when webview is ready.
  // Although ServerManager.start() handles the context argument now, we can pass context here
  // and bind it. Wait, ServerManager.start() takes `context`.
  // Let's modify ServerManager to take context in constructor or we just pass context.

  context.subscriptions.push(_openNewTerminalDisposable, openTerminalDisposable, addFilepathDisposable)

  async function openTerminal() {
    // Create a new terminal in split screen
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
      },
      location: {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      },
      env: {
        _EXTENSION_LITEAI_PORT: port.toString(),
        LITEAI_CALLER: "vscode",
      },
    })

    terminal.show()
    terminal.sendText(`liteai --port ${port}`)

    const ref = getActiveFile()
    if (!ref) {
      return
    }

    // Wait for the terminal to be ready
    let tries = 10
    let connected = false
    do {
      await new Promise((resolve) => setTimeout(resolve, 200))
      try {
        await fetch(`http://localhost:${port}/app`)
        connected = true
        break
      } catch (_e) {}

      tries--
    } while (tries > 0)

    // If connected, append the prompt to the terminal
    if (connected) {
      await appendPrompt(port, `In ${ref}`)
      terminal.show()
    }
  }

  async function appendPrompt(port: number, text: string) {
    await fetch(`http://localhost:${port}/tui/append-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    })
  }

  function getActiveFile() {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      return
    }

    const doc = editor.document
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri)
    if (!folder) {
      return
    }

    // Get the relative path from workspace root
    const rel = vscode.workspace.asRelativePath(doc.uri)
    let ref = `@${rel}`

    // Check if there's a selection and add line numbers
    const selection = editor.selection
    if (!selection.isEmpty) {
      // Convert to 1-based line numbers
      const start = selection.start.line + 1
      const end = selection.end.line + 1

      if (start === end) {
        // Single line selection
        ref += `#L${start}`
      } else {
        // Multi-line selection
        ref += `#L${start}-${end}`
      }
    }

    return ref
  }
}
