import { homedir } from "node:os"
import { basename, dirname, join, sep } from "node:path"

export function expandPath(filePath: string, basePath?: string): string {
  if (filePath.startsWith("~/")) {
    return join(homedir(), filePath.slice(2))
  }
  if (filePath === "~") {
    return homedir()
  }
  return basePath ? join(basePath, filePath) : filePath
}

export type ParsedPath = {
  directory: string
  prefix: string
}

/**
 * Parses a partial path into directory and prefix components
 */
export function parsePartialPath(partialPath: string, basePath: string): ParsedPath {
  if (!partialPath) {
    return { directory: basePath, prefix: "" }
  }

  const resolved = expandPath(partialPath, basePath)

  if (partialPath.endsWith("/") || partialPath.endsWith(sep)) {
    return { directory: resolved, prefix: "" }
  }

  const directory = dirname(resolved)
  const prefix = basename(partialPath)

  return { directory, prefix }
}

export function isPathLikeToken(token: string): boolean {
  return (
    token.startsWith("~/") ||
    token.startsWith("/") ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token === "~" ||
    token === "." ||
    token === ".."
  )
}
