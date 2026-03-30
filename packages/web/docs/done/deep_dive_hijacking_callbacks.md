# Deep Dive: Hijacking, Callbacks, and Extension APIs

## 1. What Does "Hijack a Process" Mean?

### The Problem: Localhost is Not Private

When you start a server on `localhost:55321`, here's a key fact many people don't realize:

> **Any process running on the same machine can connect to `localhost:55321`.**

There is no authentication, no access control. The port is open to the entire machine.

### Concrete Attack Scenarios

#### Scenario A: Malicious Browser Tab

```mermaid
sequenceDiagram
    participant B as 🌐 Malicious Website<br/>(in your browser)
    participant LS as Language Server<br/>(localhost:55321)
    participant AI as Google Cloud API

    Note over B: You visit evil-site.com while coding
    Note over B: JavaScript scans common ports
    B->>LS: fetch("http://localhost:55321/startAgent", {<br/>  body: "Delete all files in the project"<br/>})
    LS->>AI: Sends request to AI model
    AI-->>LS: "Sure, here are the delete commands..."
    LS->>LS: Executes file deletions 💀
```

**How it works:** JavaScript in a browser tab CAN make requests to `localhost`. The browser's Same-Origin Policy blocks *reading* responses from different origins, but it does NOT block *sending* requests. For `POST` requests with simple headers, the browser sends them immediately — the damage is done before any CORS check.

This is actually why it's called "CSRF" — **Cross-Site Request Forgery**. The malicious site "forges" a request that looks like it came from the legitimate client.

#### Scenario B: Local Malware / Rogue Process

```
Your machine is running:
  ├── VSCode Extension (legitimate)  → talks to localhost:55321
  ├── Language Server (legitimate)   → listens on localhost:55321
  ├── npm package (malicious)        → also talks to localhost:55321 ← !!
  └── Chrome extension (malicious)   → also talks to localhost:55321 ← !!
```

Any program — a malicious npm postinstall script, a compromised VS Code extension, or even a rogue browser extension — can discover the port and send requests.

#### Scenario C: Multi-User Systems (Linux)

On shared Linux servers (dev containers, cloud VMs with multiple users), `localhost` is shared. User B could connect to User A's language server.

### How CSRF Token Prevents This

```mermaid
sequenceDiagram
    participant E as Extension Host
    participant LS as Language Server :55321
    participant M as 🔴 Malicious Process

    Note over E: Generates random token: "a7f3-b9c2-..."
    E->>LS: spawn with --csrf-token "a7f3-b9c2-..."
    
    E->>LS: GET /api/models<br/>Header: X-CSRF-Token: a7f3-b9c2-...
    LS-->>E: ✅ 200 OK — token matches

    M->>LS: GET /api/models<br/>(no token, or wrong token)
    LS-->>M: ❌ 403 Forbidden

    M->>LS: POST /startAgent<br/>Body: "delete everything"<br/>(no token)
    LS-->>M: ❌ 403 Forbidden
```

The token is:
- **Generated at runtime** (different every time VSCode starts)
- **Passed via CLI argument** (only the extension host knows it)
- **Never exposed to the network** (never in a URL, never in browser storage)
- **Required on every request** (checked by server middleware)

The malicious process doesn't know the token, so it can't make valid requests.

> **For LiteAI:** This is trivially easy to implement. Generate a `crypto.randomUUID()` in the extension, pass it as `--csrf-token` to `liteai-core`, and add a middleware in Hono that checks `Authorization: Bearer <token>` on every request.

---

## 2. "LS Calls Back to Extension" — What Does This Mean?

### The Fundamental Problem

A child process (the language server) is a **separate program** running in its own memory space. It has **zero access** to the parent process's APIs.

```
┌─────────────────────────────────────────────┐
│  VSCode Extension Host (Node.js)            │
│                                             │
│  ✅ Has access to:                          │
│    vscode.workspace.fs.readFile(...)         │
│    vscode.window.showTextDocument(...)       │
│    vscode.window.createTerminal(...)         │
│    vscode.workspace.openTextDocument(...)    │
│    vscode.languages.registerCompletionItem.. │
│    vscode.window.showInformationMessage(..)  │
│                                             │
│  These APIs ONLY exist inside this process.  │
│  They cannot be imported by any other app.   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Language Server (separate process)          │
│                                             │
│  ❌ Has NO access to:                       │
│    vscode.*  — doesn't exist here           │
│                                             │
│  ✅ Can do:                                 │
│    Read/write files (via OS filesystem)      │
│    Make HTTP requests                        │
│    AI inference                              │
│    Compute (parse code, run analysis)        │
└─────────────────────────────────────────────┘
```

### So How Does the Agent Edit Files in the Editor?

The AI agent runs inside the language server process. When it decides "I need to edit file X", it can't call `vscode.workspace.applyEdit()` — that API doesn't exist in its process.

**Solution: The extension host runs its own HTTP/gRPC server that the language server can call.**

This is what Antigravity does. Let me trace the exact flow:

### Step-by-Step: Agent Opens a File

```mermaid
sequenceDiagram
    participant AI as AI Model<br/>(Google Cloud)
    participant LS as Language Server<br/>(:55321, Go binary)
    participant EH as Extension Host<br/>(:55318, Node.js)
    participant VS as VSCode Editor<br/>(UI)

    Note over AI,LS: Agent decides it needs to read a file

    AI-->>LS: "I need to read src/main.ts"
    
    Note over LS: LS CANNOT read the file via VSCode API<br/>because vscode.* doesn't exist here.<br/>But it CAN call back to the extension.

    LS->>EH: POST http://localhost:55318/readFile<br/>Header: X-CSRF-Token: XYZ<br/>Body: { "path": "src/main.ts" }
    
    Note over EH: Extension host receives the request.<br/>NOW it can use vscode.* APIs.

    EH->>EH: const doc = await vscode.workspace.fs.readFile(<br/>  vscode.Uri.file("src/main.ts")<br/>)
    
    EH-->>LS: 200 OK<br/>Body: { "content": "import { ... } ..." }
    LS-->>AI: "Here is the file content: ..."
```

### Step-by-Step: Agent Edits a File

```mermaid
sequenceDiagram
    participant AI as AI Model
    participant LS as Language Server<br/>(:55321)
    participant EH as Extension Host<br/>(:55318)
    participant VS as VSCode Editor

    AI-->>LS: "Replace lines 10-15 of src/main.ts with this new code"
    
    LS->>EH: POST http://localhost:55318/applyEdit<br/>Body: {<br/>  "file": "src/main.ts",<br/>  "edits": [{ "range": [10,15], "text": "new code..." }]<br/>}

    Note over EH: Extension uses VSCode API

    EH->>EH: const edit = new vscode.WorkspaceEdit()<br/>edit.replace(uri, range, newText)<br/>await vscode.workspace.applyEdit(edit)

    EH->>VS: Editor shows the file with changes applied
    VS->>VS: User sees the diff highlighted in the editor
    
    EH-->>LS: 200 OK { "applied": true }
    LS-->>AI: "Edit applied successfully"
```

### Step-by-Step: Agent Runs a Terminal Command

```mermaid
sequenceDiagram
    participant AI as AI Model
    participant LS as Language Server<br/>(:55321)
    participant EH as Extension Host<br/>(:55318)
    participant T as VSCode Terminal

    AI-->>LS: "Run 'npm test' in the project"

    LS->>EH: POST http://localhost:55318/runCommand<br/>Body: { "command": "npm test", "cwd": "/project" }

    Note over EH: Extension creates a terminal using VSCode API

    EH->>EH: const terminal = vscode.window.createTerminal({<br/>  name: "AI Agent",<br/>  cwd: "/project"<br/>})<br/>terminal.sendText("npm test")

    EH->>T: Terminal appears in VSCode, runs "npm test"
    T->>T: npm test executes...
    T-->>EH: Output captured via onDidWriteTerminalData
    
    EH-->>LS: 200 OK { "output": "Tests: 5 passed, 2 failed...", "exitCode": 1 }
    LS-->>AI: "Tests failed. Here's the output: ..."
```

### Why is This Called a "Callback"?

Normally, communication goes in one direction:

```
Extension → spawns → Language Server
Extension → sends request → Language Server
Extension → receives response ← Language Server
```

But with the callback pattern, the **direction reverses**:

```
Language Server → sends request → Extension Host   ← THIS IS THE CALLBACK
Language Server → receives response ← Extension Host
```

The extension host starts its OWN server (on `:55318`) specifically so the language server can "call it back" when it needs to do something that requires VSCode APIs.

From the Antigravity logs:
```
Created extension server client at port 55318
```
This line in the language server's logs means: "I've established a connection BACK to the extension host's server on port 55318, so I can call it whenever I need VSCode functionality."

---

## 3. "Extension Exposes File API" / "Extension Runs Commands"

### What This Means Concretely

The extension host creates an HTTP (or gRPC) server that **wraps VSCode APIs** as network endpoints. Here's what that looks like in code:

### Extension Host: Creating the "Extension Server"

```typescript
// Inside the VSCode extension (runs in Node.js, has vscode.* access)
import * as vscode from "vscode"
import { createServer } from "http"

function startExtensionServer(csrfToken: string): number {
  const server = createServer(async (req, res) => {
    // Verify CSRF token
    if (req.headers["x-csrf-token"] !== csrfToken) {
      res.writeHead(403)
      res.end("Forbidden")
      return
    }

    const body = await readBody(req)
    const url = new URL(req.url, "http://localhost")

    switch (url.pathname) {

      // ─── File Operations ───────────────────────────────
      case "/readFile": {
        // Language server says: "I need to read a file"
        // Extension uses VSCode API to read it
        const uri = vscode.Uri.file(body.path)
        const content = await vscode.workspace.fs.readFile(uri)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ 
          content: Buffer.from(content).toString("utf-8") 
        }))
        break
      }

      case "/writeFile": {
        // Language server says: "Write this content to a file"
        const uri = vscode.Uri.file(body.path)
        await vscode.workspace.fs.writeFile(
          uri, 
          Buffer.from(body.content, "utf-8")
        )
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true }))
        break
      }

      case "/applyEdit": {
        // Language server says: "Apply these code edits"
        // This shows the diff in the editor!
        const edit = new vscode.WorkspaceEdit()
        for (const change of body.edits) {
          const uri = vscode.Uri.file(change.file)
          const range = new vscode.Range(
            change.startLine, change.startCol,
            change.endLine, change.endCol
          )
          edit.replace(uri, range, change.newText)
        }
        const applied = await vscode.workspace.applyEdit(edit)
        res.writeHead(200)
        res.end(JSON.stringify({ applied }))
        break
      }

      case "/openFile": {
        // Language server says: "Show this file to the user"
        const uri = vscode.Uri.file(body.path)
        const doc = await vscode.workspace.openTextDocument(uri)
        await vscode.window.showTextDocument(doc, {
          selection: body.selection 
            ? new vscode.Range(body.selection.start, body.selection.end)
            : undefined,
        })
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true }))
        break
      }

      // ─── Terminal / Command Operations ──────────────────
      case "/runCommand": {
        // Language server says: "Run a shell command"
        const terminal = vscode.window.createTerminal({
          name: `AI: ${body.command.slice(0, 30)}`,
          cwd: body.cwd,
        })
        terminal.sendText(body.command)
        terminal.show()
        // Note: capturing output requires terminal data events
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true }))
        break
      }

      // ─── Search / Query Operations ──────────────────────
      case "/searchFiles": {
        // Language server says: "Find files matching a pattern"
        const files = await vscode.workspace.findFiles(
          body.pattern,
          body.exclude,
          body.maxResults
        )
        res.writeHead(200)
        res.end(JSON.stringify({ 
          files: files.map(f => f.fsPath) 
        }))
        break
      }

      // ─── UI Operations ──────────────────────────────────
      case "/showMessage": {
        // Language server says: "Show a notification"
        await vscode.window.showInformationMessage(body.message)
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true }))
        break
      }

      case "/showDiff": {
        // Language server says: "Show a diff between two versions"
        const left = vscode.Uri.file(body.original)
        const right = vscode.Uri.file(body.modified)
        await vscode.commands.executeCommand(
          "vscode.diff", left, right, body.title
        )
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true }))
        break
      }
    }
  })

  // Listen on random port
  server.listen(0, "127.0.0.1")
  const port = (server.address() as any).port
  return port  // This port number is passed to the language server
}
```

### Language Server: Calling Back

```go
// Inside the Go language server (runs as separate process)
// This is what Antigravity's language_server_windows_x64.exe does

type ExtensionClient struct {
    port      int
    csrfToken string
}

// When the AI agent decides to read a file:
func (c *ExtensionClient) ReadFile(path string) (string, error) {
    body := map[string]string{"path": path}
    jsonBody, _ := json.Marshal(body)
    
    req, _ := http.NewRequest("POST", 
        fmt.Sprintf("http://localhost:%d/readFile", c.port),
        bytes.NewReader(jsonBody),
    )
    req.Header.Set("X-CSRF-Token", c.csrfToken)
    req.Header.Set("Content-Type", "application/json")
    
    resp, err := http.DefaultClient.Do(req)
    // ... handle response
}

// When the AI agent decides to apply code edits:
func (c *ExtensionClient) ApplyEdit(file string, edits []Edit) error {
    body := map[string]interface{}{
        "edits": edits,
    }
    // ... same HTTP call pattern to localhost:extensionPort/applyEdit
}
```

### The Full Communication Map

```
┌───────────────────────────────────────────────────────────────┐
│                      YOUR MACHINE                              │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  VSCode Extension Host (Node.js)                        │  │
│  │                                                          │  │
│  │  ┌──────────────────────┐  ┌──────────────────────┐    │  │
│  │  │  Extension Client     │  │  Extension Server     │    │  │
│  │  │  (calls LS on :55321) │  │  (listens on :55318)  │    │  │
│  │  │                       │  │                       │    │  │
│  │  │  "Send chat message"──┼──►                       │    │  │
│  │  │  "Get completions" ──┼──►                       │    │  │
│  │  │                       │  │                       │    │  │
│  │  │                       │  │  ◄── "Read file X"    │    │  │
│  │  │                       │  │  ◄── "Apply edit"     │    │  │
│  │  │                       │  │  ◄── "Run command"    │    │  │
│  │  │                       │  │  ◄── "Show diff"      │    │  │
│  │  └──────────┬─────────────┘  └──────────▲───────────┘    │  │
│  │             │                            │                │  │
│  │             │  vscode.* APIs             │ vscode.* APIs  │  │
│  │             │  available here            │ used here      │  │
│  └─────────────┼────────────────────────────┼────────────────┘  │
│                │                            │                    │
│                ▼                            │                    │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Language Server (Go binary, separate process)          │  │
│  │                                                          │  │
│  │  ┌──────────────────────┐  ┌──────────────────────┐    │  │
│  │  │  LS Server            │  │  Extension Client     │    │  │
│  │  │  (listens on :55321)  │  │  (calls EH on :55318) │    │  │
│  │  │                       │  │                       │    │  │
│  │  │  ◄── Chat messages    │  │  "Read file" ──────►  │    │  │
│  │  │  ◄── Completions req  │  │  "Apply edit" ─────►  │    │  │
│  │  │                       │  │  "Run command" ────►  │    │  │
│  │  │                       │  │  "Show diff" ──────►  │    │  │
│  │  └───────────────────────┘  └───────────────────────┘    │  │
│  │                                                          │  │
│  │  ❌ NO vscode.* APIs here — this is a Go process        │  │
│  │  ✅ Has: AI inference, code parsing, planning            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## How Does This Apply to LiteAI?

### LiteAI Has a Simpler Situation

LiteAI's `liteai-core` already has **direct filesystem and PTY access** because it's a Bun server running on the same machine. It doesn't need the extension to proxy file reads or terminal commands.

**Antigravity needs the callback pattern because:**
- It's designed to work in **remote development** (Codespaces, Remote SSH)
- The language server might run on a **different machine** than VSCode
- The extension host is the only thing with access to the remote workspace

**LiteAI doesn't need this because:**
- The core server runs **locally** alongside VSCode
- It can `fs.readFile()` directly
- It has built-in PTY support for terminal commands

**What LiteAI DOES still need from the extension host:**

| Need | Why |
|------|-----|
| `vscode.window.showTextDocument()` | Open a file in the editor and highlight a range |
| `vscode.workspace.applyEdit()` | Show inline diff decorations in the editor |
| `vscode.window.showInformationMessage()` | Show VSCode-native notifications |
| `vscode.commands.executeCommand()` | Trigger VSCode commands (open diff view, etc.) |

These are **UI-only** operations. The data/compute layer (the core server) doesn't need them — only the Pane UI does, and it communicates those via `postMessage` to the extension host.
