import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import * as lockfile from "proper-lockfile"
import { Global } from "../global"

const logger = Log.create({ service: "coordinator.mailbox" })

export interface TeammateMessage {
  from: string
  text: string
  timestamp: string
  read: boolean
  color?: string
  summary?: string
}

/** Sanitize a name for filesystem use (local copy — avoids mock.module cache poisoning). */
function sanitizePathComponent(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
}

/** Resolve teams base directory directly from Global.Path.root. */
function getTeamsDir(): string {
  return path.join(Global.Path.root, "teams")
}

/**
 * Ensures the inboxes directory exists for a team.
 */
export async function ensureInboxDir(teamName: string): Promise<string> {
  const dir = path.join(getTeamsDir(), sanitizePathComponent(teamName), "inboxes")
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/**
 * Gets the file path for an agent's inbox within a team.
 */
export function getInboxPath(agentName: string, teamName: string): string {
  const safeTeam = sanitizePathComponent(teamName)
  const safeAgent = sanitizePathComponent(agentName)
  return path.join(getTeamsDir(), safeTeam, "inboxes", `${safeAgent}.json`)
}

/**
 * Reads all messages from a teammate's mailbox.
 * If the mailbox doesn't exist, returns an empty array.
 */
export async function readMailbox(agentName: string, teamName: string): Promise<TeammateMessage[]> {
  const inboxPath = getInboxPath(agentName, teamName)
  try {
    const raw = await fs.readFile(inboxPath, "utf-8")
    return JSON.parse(raw) as TeammateMessage[]
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return []
    }
    // Non-ENOENT errors (permission denied, corrupted JSON, disk errors) must
    // surface immediately — silent fallbacks hide systemic issues (Constitution §5).
    throw new Error(
      `Failed to read mailbox for ${agentName} in team ${teamName}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Reads only the unread messages from a teammate's mailbox.
 */
export async function readUnreadMessages(agentName: string, teamName: string): Promise<TeammateMessage[]> {
  const messages = await readMailbox(agentName, teamName)
  return messages.filter((m) => !m.read)
}

/**
 * Writes a message to a teammate's mailbox.
 * Uses proper-lockfile to safely append to the JSON array concurrently.
 */
export async function writeToMailbox(recipientName: string, message: TeammateMessage, teamName: string): Promise<void> {
  const inboxDir = await ensureInboxDir(teamName)
  const inboxPath = path.join(inboxDir, `${sanitizePathComponent(recipientName)}.json`)

  // Ensure file exists before locking (proper-lockfile requires the file to exist)
  try {
    await fs.access(inboxPath)
  } catch {
    // Try to create it atomically. If it fails, another process beat us to it, which is fine.
    try {
      await fs.writeFile(inboxPath, "[]", { flag: "wx" })
    } catch (e: unknown) {
      if (e instanceof Error && "code" in e && e.code !== "EEXIST") throw e
      // Non-Error thrown or EEXIST — another process created it first, which is fine.
      if (!(e instanceof Error)) throw e
    }
  }

  let releaseLock: () => Promise<void>
  try {
    // Retry up to 10 times, starting at 5ms delay up to 100ms
    releaseLock = await lockfile.lock(inboxPath, {
      retries: { retries: 50, minTimeout: 10, maxTimeout: 200 },
    })
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error("failed to acquire mailbox lock", { recipientName, teamName, error: errMsg })
    throw new Error(`Could not acquire lock for mailbox ${recipientName}: ${errMsg}`)
  }

  try {
    const raw = await fs.readFile(inboxPath, "utf-8")
    let messages: TeammateMessage[]
    try {
      messages = JSON.parse(raw)
    } catch (parseError) {
      // Back up corrupted file before failing — prevents silent data loss (Constitution §5).
      const backupPath = `${inboxPath}.corrupted.${Date.now()}`
      await fs.copyFile(inboxPath, backupPath)
      throw new Error(
        `Corrupted mailbox for ${recipientName} (backed up to ${backupPath}): ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      )
    }
    messages.push(message)
    await fs.writeFile(inboxPath, JSON.stringify(messages, null, 2), "utf-8")
  } finally {
    await releaseLock()
  }
}

/**
 * Marks all messages in a mailbox as read.
 */
export async function markMessagesAsRead(agentName: string, teamName: string): Promise<void> {
  const inboxPath = getInboxPath(agentName, teamName)

  let releaseLock: () => Promise<void>
  try {
    releaseLock = await lockfile.lock(inboxPath, {
      retries: { retries: 50, minTimeout: 10, maxTimeout: 200 },
    })
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error("failed to acquire lock to mark read", { agentName, teamName, error: errMsg })
    throw new Error(`Failed to acquire lock for mailbox ${agentName}: ${errMsg}`)
  }

  try {
    const raw = await fs.readFile(inboxPath, "utf-8")
    let messages: TeammateMessage[]
    try {
      messages = JSON.parse(raw)
    } catch (parseError) {
      const backupPath = `${inboxPath}.corrupted.${Date.now()}`
      await fs.copyFile(inboxPath, backupPath)
      throw new Error(
        `Corrupted mailbox for ${agentName} (backed up to ${backupPath}): ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      )
    }

    let changed = false
    for (const msg of messages) {
      if (!msg.read) {
        msg.read = true
        changed = true
      }
    }

    if (changed) {
      await fs.writeFile(inboxPath, JSON.stringify(messages, null, 2), "utf-8")
    }
  } finally {
    await releaseLock()
  }
}

/**
 * Marks a specific message as read by its index.
 */
export async function markMessageAsReadByIndex(agentName: string, teamName: string, index: number): Promise<void> {
  const inboxPath = getInboxPath(agentName, teamName)

  let releaseLock: () => Promise<void>
  try {
    releaseLock = await lockfile.lock(inboxPath, {
      retries: { retries: 50, minTimeout: 10, maxTimeout: 200 },
    })
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error("failed to acquire lock to mark read by index", { agentName, teamName, error: errMsg })
    throw new Error(`Failed to acquire lock for mailbox ${agentName}: ${errMsg}`)
  }

  try {
    const raw = await fs.readFile(inboxPath, "utf-8")
    let messages: TeammateMessage[]
    try {
      messages = JSON.parse(raw)
    } catch (parseError) {
      const backupPath = `${inboxPath}.corrupted.${Date.now()}`
      await fs.copyFile(inboxPath, backupPath)
      throw new Error(
        `Corrupted mailbox for ${agentName} (backed up to ${backupPath}): ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      )
    }

    if (index >= 0 && index < messages.length && !messages[index].read) {
      messages[index].read = true
      await fs.writeFile(inboxPath, JSON.stringify(messages, null, 2), "utf-8")
    }
  } finally {
    await releaseLock()
  }
}

/**
 * Clears all messages from a mailbox.
 */
export async function clearMailbox(agentName: string, teamName: string): Promise<void> {
  const inboxPath = getInboxPath(agentName, teamName)

  let releaseLock: () => Promise<void>
  try {
    releaseLock = await lockfile.lock(inboxPath, {
      retries: { retries: 50, minTimeout: 10, maxTimeout: 200 },
    })
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error("failed to acquire lock to clear mailbox", { agentName, teamName, error: errMsg })
    throw new Error(`Failed to acquire lock for mailbox ${agentName}: ${errMsg}`)
  }

  try {
    await fs.writeFile(inboxPath, "[]", "utf-8")
  } finally {
    await releaseLock()
  }
}

/**
 * Formats teammate messages as XML for inclusion in prompts or UI streams.
 */
export function formatTeammateMessages(messages: TeammateMessage[]): string {
  if (messages.length === 0) return ""

  const blocks = messages.map((msg) => {
    return `<teammate-message from="${msg.from}" timestamp="${msg.timestamp}">\n${msg.text}\n</teammate-message>`
  })

  return blocks.join("\n\n")
}
