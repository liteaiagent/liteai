import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import { Global } from "../global"

const log = Log.create({ service: "coordinator.team" })

export interface TeamFile {
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  leadSessionId: string
  members: TeamMember[]
}

export interface TeamMember {
  agentId: string
  name: string
  agentType: string
  joinedAt: number
  cwd: string
  color?: string
  isActive?: boolean
}

/** Base directory for all team data. */
export function teamsBaseDir(): string {
  return path.join(Global.Path.root, "teams")
}

/** Directory for a specific team. */
export function teamDir(teamName: string): string {
  return path.join(teamsBaseDir(), sanitizeTeamName(teamName))
}

/** Path to a team's config file. */
export function teamConfigPath(teamName: string): string {
  return path.join(teamDir(teamName), "config.json")
}

/** Sanitize a team name for filesystem use. */
export function sanitizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
}

/** Write a team config file, creating directories as needed. */
export async function writeTeamFile(teamName: string, config: TeamFile): Promise<string> {
  const configPath = teamConfigPath(teamName)
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  // Create inboxes directory for Phase 2 mailbox
  await fs.mkdir(path.join(teamDir(teamName), "inboxes"), { recursive: true })
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8")
  log.info("wrote team config", { teamName, configPath })
  return configPath
}

/** Read a team config file. Returns null if not found. */
export async function readTeamFile(teamName: string): Promise<TeamFile | null> {
  try {
    const raw = await fs.readFile(teamConfigPath(teamName), "utf-8")
    return JSON.parse(raw) as TeamFile
  } catch {
    return null
  }
}

/** Remove a team's directory tree. */
export async function cleanupTeamDirectories(teamName: string): Promise<void> {
  const dir = teamDir(teamName)
  try {
    await fs.rm(dir, { recursive: true, force: true })
    log.info("cleaned up team directory", { teamName, dir })
  } catch (e) {
    log.warn("failed to clean up team directory", { teamName, dir, error: e })
  }
}
