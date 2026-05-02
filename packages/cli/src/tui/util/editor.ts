import { type SpawnSyncOptions, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { instances } from "@liteai/ink"

/**
 * Editors known to be GUI-based (open a separate window).
 * When detected, we pause Ink + suspend stdin instead of entering alternate screen.
 */
const GUI_EDITORS = new Set(["code", "cursor", "windsurf", "codium", "subl", "notepad++", "notepad", "atom", "zed"])

/**
 * Editors that need a `--wait` flag to block until the user closes the file.
 */
const WAIT_FLAG_OVERRIDES: Record<string, string> = {
  code: "--wait",
  cursor: "--wait",
  windsurf: "--wait",
  codium: "--wait",
  subl: "--wait",
  atom: "--wait",
  zed: "--wait",
}

/**
 * Resolve the user's preferred editor from environment variables or platform defaults.
 */
export function getExternalEditor(): string | undefined {
  const visual = process.env.VISUAL?.trim()
  if (visual) return visual
  const editor = process.env.EDITOR?.trim()
  if (editor) return editor
  // Platform fallbacks
  if (os.platform() === "win32") return "notepad"
  return undefined
}

/**
 * Classify whether an editor command refers to a GUI editor.
 * GUI editors open a separate window and require `--wait` flags;
 * terminal editors (vim, nano, etc.) take over the terminal directly.
 */
export function isGuiEditor(editorCmd: string): boolean {
  const base = path.basename(editorCmd.split(" ")[0] ?? "").replace(/\.exe$/i, "")
  return GUI_EDITORS.has(base.toLowerCase())
}

export type EditorResult = { content: string | null; error?: string }

/**
 * Open the user's external editor with the current prompt text.
 *
 * Two-path architecture:
 * - **GUI editors** (code, subl, etc.): `ink.pause()` + `ink.suspendStdin()` + spawn with --wait
 * - **Terminal editors** (vim, nano, etc.): `ink.enterAlternateScreen()` + spawnSync + `ink.exitAlternateScreen()`
 */
export function editPromptInEditor(currentPrompt: string): EditorResult {
  const editor = getExternalEditor()
  if (!editor) return { content: null, error: "No $VISUAL or $EDITOR set" }

  const inkInstance = instances.get(process.stdout)
  if (!inkInstance) return { content: null, error: "Ink instance not found" }

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "liteai-editor-"))
  const tmpFile = path.join(tmpDir, "prompt.md")
  const editorBase = path
    .basename(editor.split(" ")[0] ?? "")
    .replace(/\.exe$/i, "")
    .toLowerCase()
  const isGui = isGuiEditor(editor)

  try {
    writeFileSync(tmpFile, currentPrompt, "utf-8")

    if (isGui) {
      // GUI path: pause Ink rendering, suspend stdin, spawn with --wait flag
      inkInstance.pause()
      inkInstance.suspendStdin()
    } else {
      // Terminal path: hand over the entire screen to the editor
      inkInstance.enterAlternateScreen()
    }

    try {
      const waitFlag = WAIT_FLAG_OVERRIDES[editorBase]
      const args = waitFlag ? [waitFlag, tmpFile] : [tmpFile]
      const opts: SpawnSyncOptions = { stdio: "inherit", shell: true }
      const result = spawnSync(editor, args, opts)

      if (result.error) {
        return { content: null, error: `Editor failed to launch: ${result.error.message}` }
      }
      if (result.status !== null && result.status !== 0) {
        return { content: null, error: `Editor exited with code ${result.status}` }
      }

      let content = readFileSync(tmpFile, "utf-8")
      // Trim single trailing newline (common editor behavior)
      if (content.endsWith("\n") && !content.endsWith("\n\n")) {
        content = content.slice(0, -1)
      }
      return { content }
    } finally {
      if (isGui) {
        inkInstance.resumeStdin()
        inkInstance.resume()
      } else {
        inkInstance.exitAlternateScreen()
      }
    }
  } finally {
    try {
      unlinkSync(tmpFile)
    } catch {
      /* ignore cleanup errors */
    }
    try {
      rmdirSync(tmpDir)
    } catch {
      /* ignore */
    }
  }
}
