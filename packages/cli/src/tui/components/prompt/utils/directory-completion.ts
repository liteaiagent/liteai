import { readdir } from "node:fs/promises"
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

import type { SuggestionItem } from "./types"

// Types
export type DirectoryEntry = {
  name: string
  path: string
  type: "directory"
}

export type PathEntry = {
  name: string
  path: string
  type: "directory" | "file"
}

export type CompletionOptions = {
  basePath?: string
  maxResults?: number
}

export type PathCompletionOptions = CompletionOptions & {
  includeFiles?: boolean
  includeHidden?: boolean
}

type ParsedPath = {
  directory: string
  prefix: string
}

// Simple Map-based cache to replace lru-cache
class SimpleCache<K, V> {
  private cache = new Map<K, { value: V; timestamp: number }>()

  constructor(
    private maxSize: number,
    private ttl: number,
  ) {}

  get(key: K): V | undefined {
    const item = this.cache.get(key)
    if (!item) return undefined
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key)
      return undefined
    }
    return item.value
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest (Map iterates in insertion order)
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }
    this.cache.set(key, { value, timestamp: Date.now() })
  }

  clear(): void {
    this.cache.clear()
  }
}

const CACHE_SIZE = 500
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const directoryCache = new SimpleCache<string, DirectoryEntry[]>(CACHE_SIZE, CACHE_TTL)
const pathCache = new SimpleCache<string, PathEntry[]>(CACHE_SIZE, CACHE_TTL)

/**
 * Parses a partial path into directory and prefix components
 */
export function parsePartialPath(partialPath: string, basePath?: string): ParsedPath {
  if (!partialPath) {
    const directory = basePath || process.cwd()
    return { directory, prefix: "" }
  }

  const resolved = expandPath(partialPath, basePath)

  if (partialPath.endsWith("/") || partialPath.endsWith(sep)) {
    return { directory: resolved, prefix: "" }
  }

  const directory = dirname(resolved)
  const prefix = basename(partialPath)

  return { directory, prefix }
}

/**
 * Scans a directory and returns subdirectories
 */
export async function scanDirectory(dirPath: string): Promise<DirectoryEntry[]> {
  const cached = directoryCache.get(dirPath)
  if (cached) {
    return cached
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => ({
        name: entry.name,
        path: join(dirPath, entry.name),
        type: "directory" as const,
      }))
      .slice(0, 100)

    directoryCache.set(dirPath, directories)
    return directories
  } catch (_error) {
    return []
  }
}

/**
 * Main function to get directory completion suggestions
 */
export async function getDirectoryCompletions(
  partialPath: string,
  options: CompletionOptions = {},
): Promise<SuggestionItem[]> {
  const { basePath = process.cwd(), maxResults = 10 } = options

  const { directory, prefix } = parsePartialPath(partialPath, basePath)
  const entries = await scanDirectory(directory)
  const prefixLower = prefix.toLowerCase()
  const matches = entries.filter((entry) => entry.name.toLowerCase().startsWith(prefixLower)).slice(0, maxResults)

  return matches.map((entry) => ({
    id: entry.path,
    displayText: `${entry.name}/`,
    description: "directory",
    metadata: { type: "directory" as const },
  }))
}

export function clearDirectoryCache(): void {
  directoryCache.clear()
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

export async function scanDirectoryForPaths(dirPath: string, includeHidden = false): Promise<PathEntry[]> {
  const cacheKey = `${dirPath}:${includeHidden}`
  const cached = pathCache.get(cacheKey)
  if (cached) {
    return cached
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const paths = entries
      .filter((entry) => includeHidden || !entry.name.startsWith("."))
      .map((entry) => ({
        name: entry.name,
        path: join(dirPath, entry.name),
        type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
      }))
      .sort((a, b) => {
        if (a.type === "directory" && b.type !== "directory") return -1
        if (a.type !== "directory" && b.type === "directory") return 1
        return a.name.localeCompare(b.name)
      })
      .slice(0, 100)

    pathCache.set(cacheKey, paths)
    return paths
  } catch (_error) {
    return []
  }
}

export async function getPathCompletions(
  partialPath: string,
  options: PathCompletionOptions = {},
): Promise<SuggestionItem[]> {
  const { basePath = process.cwd(), maxResults = 10, includeFiles = true, includeHidden = false } = options

  const { directory, prefix } = parsePartialPath(partialPath, basePath)
  const entries = await scanDirectoryForPaths(directory, includeHidden)
  const prefixLower = prefix.toLowerCase()

  const matches = entries
    .filter((entry) => {
      if (!includeFiles && entry.type === "file") return false
      return entry.name.toLowerCase().startsWith(prefixLower)
    })
    .slice(0, maxResults)

  const hasSeparator = partialPath.includes("/") || partialPath.includes(sep)
  let dirPortion = ""
  if (hasSeparator) {
    const lastSlash = partialPath.lastIndexOf("/")
    const lastSep = partialPath.lastIndexOf(sep)
    const lastSeparatorPos = Math.max(lastSlash, lastSep)
    dirPortion = partialPath.substring(0, lastSeparatorPos + 1)
  }
  if (dirPortion.startsWith("./") || dirPortion.startsWith(`.${sep}`)) {
    dirPortion = dirPortion.slice(2)
  }

  return matches.map((entry) => {
    const fullPath = dirPortion + entry.name
    return {
      id: fullPath,
      displayText: entry.type === "directory" ? `${fullPath}/` : fullPath,
      metadata: { type: entry.type },
    }
  })
}

export function clearPathCache(): void {
  directoryCache.clear()
  pathCache.clear()
}
