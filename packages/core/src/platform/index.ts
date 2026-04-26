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
 * Return the currently active platform profile, or `undefined` if no
 * external platform is selected (`LITEAI_PLATFORM` is unset / "none").
 */
export function active(): PlatformProfile | undefined {
  const id = Flag.LITEAI_PLATFORM
  if (!id || id === "none") return undefined
  const profile = PROFILES[id]
  if (!profile) {
    log.warn("unknown platform profile", { id, known: Object.keys(PROFILES).join(", ") })
    return undefined
  }
  return profile
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
