import * as vscode from "vscode"
import { ChatViewProvider } from "./chat-view-provider"
import { DiffReviewManager } from "./diff-review-manager"
import { createLanguageClient } from "./language-client"
import { ServerManager } from "./server-manager"

const TERMINAL_NAME = "liteai"
let serverManager: ServerManager
let languageClient: ReturnType<typeof createLanguageClient> | undefined
let diffManager: DiffReviewManager | undefined

export function deactivate() {
  if (languageClient) {
    languageClient.stop()
  }
  if (serverManager) {
    serverManager.dispose()
  }
  if (diffManager) {
    diffManager.dispose()
  }
}

export function activate(context: vscode.ExtensionContext) {
  // ─── Edit Approval / Inline Diff ──────────────────────────────────────────
  const editApprovalEnabled = vscode.workspace.getConfiguration("liteai").get<boolean>("editApproval", true)
  if (editApprovalEnabled) {
    const outputChannel = vscode.window.createOutputChannel("LiteAI Server")
    diffManager = new DiffReviewManager(outputChannel)

    // Register CodeLens provider for all file types
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ scheme: "file" }, diffManager.codeLensProvider),
    )
    context.subscriptions.push(diffManager)
  }

  serverManager = new ServerManager(diffManager)

  const provider = new ChatViewProvider(context, serverManager)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      // Keep the webview alive when the panel is hidden (e.g. user switches to
      // Explorer or Source Control). Without this VS Code destroys the webview
      // DOM on hide, tearing down the SolidJS app, the SSE subscription, and
      // all reactive state (session ID, store, bootstrap). The tradeoff is
      // slightly higher memory usage while the extension is open.
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

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

  const showStatusDisposable = vscode.commands.registerCommand("liteai.showStatus", async () => {
    const url = serverManager.url || "(Disconnected)"
    const mode = serverManager.mode

    // QuickPick options:
    const items: vscode.QuickPickItem[] = [
      {
        label: "$(server-environment) Server Status",
        description: url,
        detail: `Mode: ${mode}`,
      },
      {
        label: "$(gear) Manage Server",
        description: "Open LiteAI server settings",
      },
      {
        label: "$(plug) MCP Tools",
        description: "Status of configured MCP connections (View Only)",
      },
      {
        label: "$(symbol-event) LSP Servers",
        description: "Connected Language Servers (Native VS Code)",
      },
    ]

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "LiteAI Status",
    })

    if (selected) {
      if (selected.label.includes("Manage Server")) {
        vscode.commands.executeCommand("workbench.action.openSettings", "liteai.server")
      } else if (selected.label.includes("MCP Tools") || selected.label.includes("LSP Servers")) {
        vscode.window.showInformationMessage(
          "This information is managed directly via VS Code Extensions or LiteAI Config files in single-project mode. Full management is available in the standalone Web app.",
          "OK",
        )
      }
    }
  })

  const showPastSessionsDisposable = vscode.commands.registerCommand("liteai.showPastSessions", async () => {
    if (!serverManager.url || !serverManager.csrf) {
      vscode.window.showErrorMessage("LiteAI server not connected")
      return
    }

    try {
      const hdrs = { Authorization: `Bearer ${serverManager.csrf}` }
      // Get project ID
      const pRes = await fetch(new URL("/project", serverManager.url).toString(), { headers: hdrs })
      if (!pRes.ok) {
        const text = await pRes.text()
        throw new Error(`Failed to list projects. Status: ${pRes.status}. Body: ${text}`)
      }
      const projects: { id: string; worktree: string }[] = await pRes.json()

      const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      let projectID = ""
      if (workspaceDir && Array.isArray(projects)) {
        const normalize = (p: string) => p.replace(/\\/g, "/").toLowerCase()
        const match = projects.find((p) => normalize(p.worktree) === normalize(workspaceDir))
        if (match) projectID = match.id
      }
      if (!projectID && projects?.length > 0) projectID = projects[0].id

      if (!projectID) {
        vscode.window.showInformationMessage("No active project found.")
        return
      }

      // Get sessions
      const sRes = await fetch(new URL(`/project/${projectID}/session`, serverManager.url).toString(), {
        headers: hdrs,
      })
      if (!sRes.ok) {
        const text = await sRes.text()
        throw new Error(`Failed to list sessions. Status: ${sRes.status}. Body: ${text}`)
      }
      const sessions: { id: string; title: string; time: { archived: boolean; created: string } }[] = await sRes.json()

      const items: (vscode.QuickPickItem & { sessionID?: string })[] = (sessions || [])
        .filter((s) => !!s.id && !s.time?.archived)
        .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .map((s) => ({
          label: s.title || "New Session",
          description: s.time?.created ? new Date(s.time.created).toLocaleString() : "",
          sessionID: s.id,
        }))

      if (items.length === 0) {
        vscode.window.showInformationMessage("No past sessions found.")
        return
      }

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a past session to open...",
        matchOnDescription: true,
      })

      if (selected?.sessionID) {
        provider.view?.webview.postMessage({ type: "load-session", sessionID: selected.sessionID })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      vscode.window.showErrorMessage(`Error loading sessions: ${msg}`)
    }
  })

  const newSessionDisposable = vscode.commands.registerCommand("liteai.newSession", () => {
    provider.view?.webview.postMessage({ type: "new-session" })
  })

  // Start the server manager (it will connect to remote or wait until explicitly told)
  // We provide the extension context. Note: ChatViewProvider will tell it to start when webview is ready.
  // Although ServerManager.start() handles the context argument now, we can pass context here
  // and bind it. Wait, ServerManager.start() takes `context`.
  // Let's modify ServerManager to take context in constructor or we just pass context.

  // ─── Workspace folder sync (Task 3.4) ───────────────────────────────────
  // When workspace folders change, register new ones with Core so it never
  // hits "Project not found in registry" errors.
  const workspaceFolderWatcher = vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
    if (serverManager.mode !== "production") return
    for (const added of event.added) {
      serverManager.registerOneFolder(added.uri.fsPath).catch(() => {
        // Non-fatal — folder will be registered on next server restart
      })
    }
  })

  // ─── LSP: start LanguageClient once core is ready ──────────────────────
  // The LanguageClient attaches to the child process stdio (which runs the
  // LSP handler alongside the HTTP server). No extra process or port needed.
  serverManager.onReady(() => {
    const proc = serverManager.process
    if (!proc) return
    languageClient = createLanguageClient(proc, context)
    languageClient.start()
    context.subscriptions.push(languageClient)
  })

  context.subscriptions.push(
    openTerminalDisposable,
    addFilepathDisposable,
    showStatusDisposable,
    showPastSessionsDisposable,
    newSessionDisposable,
    workspaceFolderWatcher,
  )

  // ─── Edit Approval Commands ─────────────────────────────────────────────
  if (diffManager) {
    const dm = diffManager

    context.subscriptions.push(
      vscode.commands.registerCommand("liteai.acceptEdit", (filePath?: string) => {
        const target = filePath || vscode.window.activeTextEditor?.document.uri.fsPath
        if (target) dm.acceptFile(target)
      }),
      vscode.commands.registerCommand("liteai.rejectEdit", async (filePath?: string) => {
        const target = filePath || vscode.window.activeTextEditor?.document.uri.fsPath
        if (target) await dm.rejectFile(target)
      }),
      vscode.commands.registerCommand("liteai.acceptAllEdits", () => {
        dm.acceptAll()
      }),
      vscode.commands.registerCommand("liteai.rejectAllEdits", async () => {
        await dm.rejectAll()
      }),
    )
  }

  async function openTerminal() {
    // Create a new terminal in split screen
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/activity-bar-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/activity-bar-light.svg")),
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
