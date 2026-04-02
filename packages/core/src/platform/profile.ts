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
}
