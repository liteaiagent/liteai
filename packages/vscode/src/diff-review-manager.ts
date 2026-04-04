import * as vscode from "vscode"

const LOG_PREFIX = "[DiffReviewManager]"

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Snapshot of a file's content before the agent's first edit. */
interface EditSnapshot {
  /** Absolute file path. */
  filePath: string
  /** Content before the first agent edit (used for revert). */
  originalContent: string
  /** Content after the latest agent edit (used for diff computation). */
  currentContent: string
  /** Ranges of added lines in the current editor. */
  addedRanges: vscode.Range[]
  /** Ranges of modified lines in the current editor. */
  modifiedRanges: vscode.Range[]
}

// ─── Line-level diff ────────────────────────────────────────────────────────────

interface DiffResult {
  added: vscode.Range[]
  modified: vscode.Range[]
}

/**
 * Computes a simple line-level diff between old and new content.
 *
 * - Lines present in new but not in old at expanded positions → "added"
 * - Lines present in both but with different content → "modified"
 *
 * This is a minimal diff suitable for decoration purposes. It compares
 * line-by-line up to the length of the longer file.
 */
function computeLineDiff(oldContent: string, newContent: string): DiffResult {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")
  const added: vscode.Range[] = []
  const modified: vscode.Range[] = []

  const maxLen = Math.max(oldLines.length, newLines.length)

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined
    const newLine = i < newLines.length ? newLines[i] : undefined

    if (newLine === undefined) {
      // Line was deleted — we don't decorate deleted lines in the new file
      // (they simply don't exist anymore)
      continue
    }

    if (oldLine === undefined) {
      // Line exists in new but not in old → added
      added.push(new vscode.Range(i, 0, i, newLine.length))
    } else if (oldLine !== newLine) {
      // Line exists in both but content differs → modified
      modified.push(new vscode.Range(i, 0, i, newLine.length))
    }
  }

  return { added, modified }
}

// ─── DiffReviewManager ─────────────────────────────────────────────────────────

/**
 * Manages inline diff decorations for agent file edits.
 *
 * When the agent edits a file, this class:
 * 1. Snapshots the original content (before the first edit)
 * 2. Computes a line-level diff
 * 3. Shows green (added) / blue (modified) gutter decorations in the editor
 * 4. Provides CodeLens with Accept / Reject controls
 *
 * The agent is never blocked — edits are auto-approved and written immediately.
 * Rejecting an edit reverts the file to its pre-edit snapshot.
 */
export class DiffReviewManager implements vscode.Disposable {
  private readonly _snapshots = new Map<string, EditSnapshot>()
  private readonly _disposables: vscode.Disposable[] = []
  private readonly _outputChannel: vscode.OutputChannel
  private readonly _codeLensProvider: DiffCodeLensProvider
  private readonly _onDidChange = new vscode.EventEmitter<void>()

  // Decoration types — created once, reused across all editors
  private readonly _addedDecoration: vscode.TextEditorDecorationType
  private readonly _modifiedDecoration: vscode.TextEditorDecorationType

  constructor(outputChannel: vscode.OutputChannel) {
    this._outputChannel = outputChannel

    this._addedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderWidth: "0 0 0 4px",
      borderStyle: "solid",
      borderColor: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
      backgroundColor: "#2ea04312",
      overviewRulerColor: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    })

    this._modifiedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderWidth: "0 0 0 4px",
      borderStyle: "solid",
      borderColor: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
      backgroundColor: "#1f6feb12",
      overviewRulerColor: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    })

    this._codeLensProvider = new DiffCodeLensProvider(this)

    // Re-apply decorations when the user switches editor tabs
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this._applyDecorationsToEditor(editor)
        }
      }),
    )

    this._disposables.push(this._addedDecoration, this._modifiedDecoration, this._onDidChange)
  }

  /** Event that fires when the set of pending edits changes (for CodeLens refresh). */
  get onDidChange() {
    return this._onDidChange.event
  }

  /** The CodeLens provider to register with VS Code. */
  get codeLensProvider(): vscode.CodeLensProvider {
    return this._codeLensProvider
  }

  // ─── Core API ───────────────────────────────────────────────────────────────

  /**
   * Track a file edit. Called by ExtensionServer after writing the file.
   *
   * @param filePath — absolute file path
   * @param oldContent — content before this write
   * @param newContent — content after this write
   */
  trackEdit(filePath: string, oldContent: string, newContent: string): void {
    const normalized = this._normalize(filePath)
    const existing = this._snapshots.get(normalized)

    const diff = computeLineDiff(oldContent, newContent)

    if (existing) {
      // File was already edited before — keep the ORIGINAL snapshot, update current
      existing.currentContent = newContent
      existing.addedRanges = diff.added
      existing.modifiedRanges = diff.modified
    } else {
      // First edit to this file — snapshot the original
      this._snapshots.set(normalized, {
        filePath,
        originalContent: oldContent,
        currentContent: newContent,
        addedRanges: diff.added,
        modifiedRanges: diff.modified,
      })
    }

    this.log(`Tracked edit: ${filePath} (+${diff.added.length} ~${diff.modified.length})`)

    // Apply decorations to the editor (if open)
    this._applyDecorationsToFile(filePath)
    this._onDidChange.fire()
  }

  /** Accept all changes to a specific file (clear decorations, discard snapshot). */
  acceptFile(filePath: string): void {
    const normalized = this._normalize(filePath)
    const snapshot = this._snapshots.get(normalized)
    if (!snapshot) return

    this._snapshots.delete(normalized)
    this._clearDecorationsForFile(filePath)
    this._onDidChange.fire()
    this.log(`Accepted: ${filePath}`)
  }

  /** Reject all changes to a specific file (revert to original, clear decorations). */
  async rejectFile(filePath: string): Promise<void> {
    const normalized = this._normalize(filePath)
    const snapshot = this._snapshots.get(normalized)
    if (!snapshot) return

    // Restore original content
    const uri = vscode.Uri.file(snapshot.filePath)
    const bytes = new TextEncoder().encode(snapshot.originalContent)
    await vscode.workspace.fs.writeFile(uri, bytes)

    this._snapshots.delete(normalized)
    this._clearDecorationsForFile(filePath)
    this._onDidChange.fire()
    this.log(`Rejected (reverted): ${filePath}`)
  }

  /** Accept all pending edits. */
  acceptAll(): void {
    const files = Array.from(this._snapshots.keys())
    for (const file of files) {
      const snapshot = this._snapshots.get(file)
      if (snapshot) this.acceptFile(snapshot.filePath)
    }
  }

  /** Reject all pending edits. */
  async rejectAll(): Promise<void> {
    const files = Array.from(this._snapshots.keys())
    for (const file of files) {
      const snapshot = this._snapshots.get(file)
      if (snapshot) await this.rejectFile(snapshot.filePath)
    }
  }

  /** Whether there are any pending (unreviewed) edits. */
  hasPendingEdits(): boolean {
    return this._snapshots.size > 0
  }

  /** List of file paths with pending edits. */
  pendingFiles(): string[] {
    return Array.from(this._snapshots.values()).map((s) => s.filePath)
  }

  /** Check if a specific file has pending edits. */
  hasPendingEdit(filePath: string): boolean {
    return this._snapshots.has(this._normalize(filePath))
  }

  // ─── Decoration management ────────────────────────────────────────────────

  private _applyDecorationsToFile(filePath: string) {
    const editor = vscode.window.visibleTextEditors.find(
      (e) => this._normalize(e.document.uri.fsPath) === this._normalize(filePath),
    )
    if (editor) {
      this._applyDecorationsToEditor(editor)
    }
  }

  private _applyDecorationsToEditor(editor: vscode.TextEditor) {
    const normalized = this._normalize(editor.document.uri.fsPath)
    const snapshot = this._snapshots.get(normalized)

    if (!snapshot) {
      // No pending edit for this file — clear any stale decorations
      editor.setDecorations(this._addedDecoration, [])
      editor.setDecorations(this._modifiedDecoration, [])
      return
    }

    editor.setDecorations(this._addedDecoration, snapshot.addedRanges)
    editor.setDecorations(this._modifiedDecoration, snapshot.modifiedRanges)
  }

  private _clearDecorationsForFile(filePath: string) {
    const editor = vscode.window.visibleTextEditors.find(
      (e) => this._normalize(e.document.uri.fsPath) === this._normalize(filePath),
    )
    if (editor) {
      editor.setDecorations(this._addedDecoration, [])
      editor.setDecorations(this._modifiedDecoration, [])
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Normalize path for cross-platform map keys. */
  private _normalize(p: string): string {
    return p.replace(/\\/g, "/").toLowerCase()
  }

  private log(msg: string) {
    this._outputChannel.appendLine(`${LOG_PREFIX} ${msg}`)
  }

  dispose() {
    for (const d of this._disposables) d.dispose()
    this._snapshots.clear()
  }
}

// ─── CodeLens Provider ──────────────────────────────────────────────────────────

class DiffCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>()
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event

  constructor(private readonly _manager: DiffReviewManager) {
    // Refresh CodeLenses when pending edits change
    _manager.onDidChange(() => this._onDidChangeCodeLenses.fire())
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this._manager.hasPendingEdit(document.uri.fsPath)) {
      return []
    }

    const topLine = new vscode.Range(0, 0, 0, 0)

    return [
      new vscode.CodeLens(topLine, {
        title: "✓ Accept Changes",
        command: "liteai.acceptEdit",
        arguments: [document.uri.fsPath],
        tooltip: "Accept all agent changes to this file",
      }),
      new vscode.CodeLens(topLine, {
        title: "✗ Reject Changes",
        command: "liteai.rejectEdit",
        arguments: [document.uri.fsPath],
        tooltip: "Revert this file to its state before the agent edited it",
      }),
      ...(this._manager.pendingFiles().length > 1
        ? [
            new vscode.CodeLens(topLine, {
              title: `✓ Accept All (${this._manager.pendingFiles().length} files)`,
              command: "liteai.acceptAllEdits",
              tooltip: "Accept all pending agent changes across all files",
            }),
            new vscode.CodeLens(topLine, {
              title: `✗ Reject All (${this._manager.pendingFiles().length} files)`,
              command: "liteai.rejectAllEdits",
              tooltip: "Revert all files to their state before the agent edited them",
            }),
          ]
        : []),
    ]
  }
}
