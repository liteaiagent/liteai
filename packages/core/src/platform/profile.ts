import { Log } from "@liteai/util/log"
import type { Config } from "@/config/config"
import type { PermissionNext } from "@/permission/next"

/**
 * A platform profile defines the directory conventions, file patterns,
 * and compatibility mappings for an external coding agent tool
 * (Claude Code, Gemini CLI, Codex, etc.).
 *
 * Each supported platform is represented as a self-contained profile.
 * The system selects ONE active profile at a time via `LITEAI_PLATFORM`.
 */
export interface PlatformProfile {
  /** Unique identifier for this platform (used in config and env var). */
  readonly id: string

  /** Human-readable display name. */
  readonly name: string

  /**
   * Directories to scan for agents, skills, etc.
   * These are platform-specific (e.g., `.claude` for Claude Code).
   * Replaces the default neutral directories when the platform is active.
   */
  readonly dirs: string[]

  /**
   * Instruction file basenames to search for in project and global scopes.
   * e.g., `["CLAUDE.md"]` for Claude Code.
   * Replaces the default `"AGENTS.md"` when the platform is active.
   */
  readonly instructionFiles: string[]

  /**
   * Global instruction file paths (absolute) to load from the home directory.
   * Return paths like `~/.claude/CLAUDE.md` for Claude Code.
   */
  globalInstructionPaths(home: string): string[]

  /**
   * Whether this platform uses `.mcp.json` files (Claude Code format).
   * When false, `.mcp.json` discovery/loading is skipped for this platform.
   */
  readonly mcpJson: boolean

  /**
   * Whether to enable provider-specific schema compatibility fields
   * during agent config processing (e.g., `tools`, `disallowedTools`,
   * `permissionMode`, `maxTurns` for Claude Code).
   */
  readonly schemaCompat: boolean

  /**
   * Optional transform function for provider-specific agent frontmatter
   * fields into LiteAI permission rules.
   *
   * For Claude Code: maps `tools` / `disallowedTools` / `permissionMode`.
   * Returns `undefined` if no compat fields are present.
   */
  permissionTransform?(value: Config.Agent): PermissionNext.Ruleset | undefined

  /**
   * Optional mapping from platform-specific tool names to liteai canonical tool IDs.
   * Resolves PascalCase (e.g., "Edit") to lowercase ("edit").
   */
  readonly toolNameMap?: Record<string, string>
}

/**
 * Utility to normalize tool names using the provided toolNameMap.
 * Unknown names pass through unchanged.
 */
export function normalizeToolNames<T extends string | string[] | Record<string, boolean>>(
  names: T,
  map?: Record<string, string>,
): T extends string ? string[] : T {
  if (names == null) return names as unknown as T extends string ? string[] : T

  if (typeof names === "string") {
    const list = names
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    return list.map((name) => map?.[name] ?? name) as unknown as T extends string ? string[] : T
  }

  if (Array.isArray(names)) {
    return names.map((name) => {
      const trimmed = name.trim()
      return map?.[trimmed] ?? trimmed
    }) as unknown as T extends string ? string[] : T
  }

  const log = Log.create({ service: "platform.profile" })
  const result: Record<string, boolean> = {}
  for (const [key, val] of Object.entries(names)) {
    const normalizedKey = map?.[key] ?? key
    if (normalizedKey in result && result[normalizedKey] !== val) {
      log.warn("normalizeToolNames: key collision after normalization — last-write-wins", {
        originalKey: key,
        normalizedKey,
        priorValue: result[normalizedKey],
        incomingValue: val,
      })
    }
    result[normalizedKey] = val
  }
  return result as unknown as T extends string ? string[] : T
}
