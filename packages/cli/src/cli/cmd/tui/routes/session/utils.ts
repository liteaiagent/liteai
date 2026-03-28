import path from "node:path"
import type { ScrollAcceleration } from "@opentui/core"
import { LANGUAGE_EXTENSIONS } from "liteai/lsp/language"

export const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

export class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

export function normalizePath(val?: string) {
  if (!val) return ""

  const cwd = process.cwd()
  const absolute = path.isAbsolute(val) ? val : path.resolve(cwd, val)
  const relative = path.relative(cwd, absolute)

  if (!relative) return "."
  if (!relative.startsWith("..")) return relative

  // outside cwd - use absolute
  return absolute
}

export function formatInput(val: Record<string, unknown>, omit?: string[]): string {
  const primitives = Object.entries(val).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

export function filetype(val?: string) {
  if (!val) return "none"
  const ext = path.extname(val)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}
