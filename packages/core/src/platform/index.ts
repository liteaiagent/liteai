import { AsyncLocalStorage } from "node:async_hooks"
import { Log } from "@liteai/util/log"
import { Flag } from "@/flag/flag"
import type { PlatformProfile } from "./profile"
import { claude } from "./profiles/claude"
import { codex } from "./profiles/codex"
import { gemini } from "./profiles/gemini"
import { standard } from "./profiles/standard"

export type { PlatformProfile } from "./profile"
export { normalizeToolNames } from "./profile"

const log = Log.create({ service: "platform" })

/** Registry of all known platform profiles indexed by id. */
const PROFILES: Record<string, PlatformProfile> = {
  claude: claude,
  gemini: gemini,
  codex: codex,
  standard: standard,
}

/**
 * AsyncLocalStorage override for the platform ID.
 * When the store contains a value, `active()` uses it instead of
 * `Flag.LITEAI_PLATFORM`. Eliminates process.env race conditions
 * during parallel test execution.
 *
 * Store semantics:
 * - `undefined` (no store) → fall through to env var
 * - `null`                 → no platform active
 * - `string`               → use this platform ID
 */
const platformOverride = new AsyncLocalStorage<string | null>()

/**
 * Return the currently active platform profile, or `undefined` if no
 * external platform is selected (`LITEAI_PLATFORM` is unset / "none").
 *
 * When called inside a `withOverride()` scope, the override value
 * takes precedence over the environment variable.
 */
export function active(): PlatformProfile | undefined {
  const override = platformOverride.getStore()
  // undefined means no override store — fall through to env var.
  // null means explicitly "no platform".
  const id = override !== undefined ? override : Flag.LITEAI_PLATFORM
  if (!id || id === "none") return undefined
  const profile = PROFILES[id]
  if (!profile) {
    log.warn("unknown platform profile", { id, known: Object.keys(PROFILES).join(", ") })
    return undefined
  }
  return profile
}

/**
 * Run `fn` with a platform override that is isolated to the current
 * async context via `AsyncLocalStorage`. Does not touch `process.env`.
 * Safe for parallel test execution.
 *
 * @param id - Platform profile ID (e.g., `"claude"`, `"standard"`),
 *             or `null` to simulate no platform being active.
 */
export function withOverride<R>(id: string | null, fn: () => R): R {
  return platformOverride.run(id, fn)
}

/**
 * Directories to scan for platform agents and skills.
 *
 * When a platform is active, ONLY its directories are returned.
 * When no platform is active (LiteAI mode), an empty list is returned.
 */
export function dirs(): string[] {
  const profile = active()
  if (profile) return profile.dirs
  return []
}

/**
 * Instruction file basenames to search for in project directories.
 *
 * When a platform is active, ONLY its instruction files are returned.
 * When no platform is active, LiteAI defaults are returned.
 */
export function instructionFiles(): string[] {
  const profile = active()
  if (profile) return profile.instructionFiles
  return ["AGENTS.md"]
}

/**
 * Global instruction file paths to load from the home directory.
 *
 * Only returns paths when a platform is active and defines them.
 */
export function globalInstructionPaths(home: string): string[] {
  const profile = active()
  return profile?.globalInstructionPaths(home) ?? []
}

/** List all registered platform profile IDs. */
export function available(): string[] {
  return Object.keys(PROFILES)
}

/**
 * Valid environment variable prefixes for all known platforms.
 * Always includes "LITEAI", followed by the uppercase ID of each registered platform.
 */
export function envPrefixes(): string[] {
  return ["LITEAI", ...available().map((id) => id.toUpperCase())]
}
