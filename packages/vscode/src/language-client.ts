import type { ChildProcess } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import * as vscode from "vscode"
import { LanguageClient, type LanguageClientOptions, type StreamInfo } from "vscode-languageclient/node"

/**
 * Create a LanguageClient that connects to the LiteAI core LSP handler
 * via the existing child process's stdin/stdout.
 *
 * The core process runs two servers simultaneously:
 *   - HTTP (Hono) on a port — handles chat, sessions, API
 *   - LSP on stdio — handles AI inline completions (Phase 1)
 *
 * We reuse the same process that ServerManager already spawned,
 * so there is no extra process, no extra port, no extra auth.
 */
export function createLanguageClient(coreProcess: ChildProcess, _context: vscode.ExtensionContext): LanguageClient {
  const clientOptions: LanguageClientOptions = {
    // Provide completions for all file types
    documentSelector: [{ scheme: "file", pattern: "**/*" }],
    synchronize: {},
    outputChannel: vscode.window.createOutputChannel("LiteAI LSP"),
  }

  // Stream-based connection — reuse the already-running child process stdio
  const serverOptions = (): Promise<StreamInfo> =>
    Promise.resolve({
      reader: coreProcess.stdout as Readable,
      writer: coreProcess.stdin as Writable,
    })

  return new LanguageClient("liteai-lsp", "LiteAI AI Features", serverOptions, clientOptions)
}
