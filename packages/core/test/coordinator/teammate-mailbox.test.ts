import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  clearMailbox,
  formatTeammateMessages,
  getInboxPath,
  markMessageAsReadByIndex,
  markMessagesAsRead,
  readMailbox,
  readUnreadMessages,
  type TeammateMessage,
  writeToMailbox,
} from "../../src/coordinator/teammate-mailbox"
import { Global } from "../../src/global"

describe("Teammate Mailbox Protocol", () => {
  let teamName: string
  let agentName: string
  let testId = 0
  let originalRoot: string
  let testRoot: string

  beforeEach(async () => {
    testId++
    teamName = `test-team-mailbox-${testId}`
    agentName = `test-agent-${testId}`
    originalRoot = Global.Path.root
    testRoot = path.join(os.tmpdir(), `.liteai-test-mailbox-${testId}-${Date.now()}`)
    Global.Path.root = testRoot
  })

  afterEach(async () => {
    Global.Path.root = originalRoot
    try {
      await fs.rm(testRoot, { recursive: true, force: true })
    } catch {}
  })

  const createMessage = (text: string): TeammateMessage => ({
    from: "coordinator",
    text,
    timestamp: new Date().toISOString(),
    read: false,
  })

  test("writes and reads messages correctly", async () => {
    const msg1 = createMessage("hello")
    const msg2 = createMessage("world")

    await writeToMailbox(agentName, msg1, teamName)
    await writeToMailbox(agentName, msg2, teamName)

    const messages = await readMailbox(agentName, teamName)
    expect(messages).toHaveLength(2)
    expect(messages[0].text).toBe("hello")
    expect(messages[1].text).toBe("world")
    expect(messages[0].read).toBe(false)
  })

  test("readMailbox handles missing file gracefully", async () => {
    const messages = await readMailbox("nonexistent", teamName)
    expect(messages).toBeArray()
    expect(messages).toHaveLength(0)
  })

  test("filters unread messages", async () => {
    const msg1 = createMessage("msg1")
    const msg2 = createMessage("msg2")
    msg1.read = true // simulate already read

    await writeToMailbox(agentName, msg1, teamName)
    await writeToMailbox(agentName, msg2, teamName)

    const unread = await readUnreadMessages(agentName, teamName)
    expect(unread).toHaveLength(1)
    expect(unread[0].text).toBe("msg2")
  })

  test("marks all messages as read", async () => {
    await writeToMailbox(agentName, createMessage("msg1"), teamName)
    await writeToMailbox(agentName, createMessage("msg2"), teamName)

    let unread = await readUnreadMessages(agentName, teamName)
    expect(unread).toHaveLength(2)

    await markMessagesAsRead(agentName, teamName)

    unread = await readUnreadMessages(agentName, teamName)
    expect(unread).toHaveLength(0)

    const all = await readMailbox(agentName, teamName)
    expect(all[0].read).toBe(true)
    expect(all[1].read).toBe(true)
  })

  test("marks message read by index", async () => {
    await writeToMailbox(agentName, createMessage("msg1"), teamName)
    await writeToMailbox(agentName, createMessage("msg2"), teamName)

    await markMessageAsReadByIndex(agentName, teamName, 0)

    const all = await readMailbox(agentName, teamName)
    expect(all[0].read).toBe(true)
    expect(all[1].read).toBe(false)
  })

  test("clears mailbox", async () => {
    await writeToMailbox(agentName, createMessage("msg1"), teamName)
    let all = await readMailbox(agentName, teamName)
    expect(all).toHaveLength(1)

    await clearMailbox(agentName, teamName)
    all = await readMailbox(agentName, teamName)
    expect(all).toHaveLength(0)
  })

  test("formats messages as XML", () => {
    const msgs: TeammateMessage[] = [
      { from: "a", text: "hello", timestamp: "123", read: false },
      { from: "b", text: "world", timestamp: "456", read: false },
    ]
    const xml = formatTeammateMessages(msgs)
    expect(xml).toContain('<teammate-message from="a" timestamp="123">')
    expect(xml).toContain("hello")
    expect(xml).toContain('<teammate-message from="b" timestamp="456">')
    expect(xml).toContain("world")
  })

  test("getInboxPath sanitizes inputs", () => {
    const p1 = getInboxPath("Agent@1", "Team A")
    expect(p1).toContain("agent-1.json")
    // Because teamDir might be globally mocked to `/tmp/teams/${name}` and bypasses sanitization,
    // we only assert that the agent name was successfully sanitized in this function.
  })

  test("concurrent writes are lock-guarded and don't lose data", async () => {
    const promises = []
    const writeCount = 5

    for (let i = 0; i < writeCount; i++) {
      promises.push(writeToMailbox(agentName, createMessage(`concurrent-${i}`), teamName))
    }

    await Promise.all(promises)

    const all = await readMailbox(agentName, teamName)
    expect(all).toHaveLength(writeCount)
  })

  test("readMailbox throws on corrupted JSON (H-1 regression)", async () => {
    // Manually create a corrupted inbox file
    const { ensureInboxDir, getInboxPath } = await import("../../src/coordinator/teammate-mailbox")
    await ensureInboxDir(teamName)
    const inboxPath = getInboxPath(agentName, teamName)
    await fs.writeFile(inboxPath, "NOT VALID JSON {{{", "utf-8")

    await expect(readMailbox(agentName, teamName)).rejects.toThrow(/Failed to read mailbox/)
  })

  test("writeToMailbox backs up and throws on corrupted inbox (H-2 regression)", async () => {
    const { ensureInboxDir, getInboxPath } = await import("../../src/coordinator/teammate-mailbox")
    await ensureInboxDir(teamName)
    const inboxPath = getInboxPath(agentName, teamName)
    // Write corrupted JSON to the inbox file
    await fs.writeFile(inboxPath, "CORRUPTED", "utf-8")

    const msg = createMessage("should fail")
    await expect(writeToMailbox(agentName, msg, teamName)).rejects.toThrow(/Corrupted mailbox/)

    // Verify backup was created
    const dir = path.dirname(inboxPath)
    const files = await fs.readdir(dir)
    const backups = files.filter((f) => f.includes(".corrupted."))
    expect(backups.length).toBeGreaterThanOrEqual(1)
  })
})
