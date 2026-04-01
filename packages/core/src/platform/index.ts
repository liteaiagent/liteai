import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import type { PlatformProfile } from "./profile"
import { claude } from "./profiles/claude"
import { codex } from "./profiles/codex"
import { gemini } from "./profiles/gemini"

export type { PlatformProfile } from "./profile"

const log = Log.create({ service: "platform" })

/** Registry of all known platform profiles indexed by id. */
const PROFILES: Record<string, PlatformProfile> = {
  claude: claude,
  gemini: gemini,
  codex: codex,
}

/**
 * Neutral directories that are always scanned regardless of which
 * platform is active. `.agents/` is the provider-agnostic convention.
 */
const NEUTRAL_DIRS = [".agents"]

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
 * Directories to scan for external agents and skills.
 *
 * Always includes the neutral `.agents/` convention.
 * When a platform is active, its directories are appended.
 */
export function externalDirs(): string[] {
  const profile = active()
  return [...NEUTRAL_DIRS, ...(profile?.dirs ?? [])]
}

/**
 * Instruction file basenames to search for in project directories.
 *
 * Always includes `"AGENTS.md"` (LiteAI native convention).
 * When a platform is active, its instruction files are appended.
 */
export function instructionFiles(): string[] {
  const profile = active()
  return ["AGENTS.md", ...(profile?.instructionFiles ?? [])]
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
