import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SidechainTranscript, type TranscriptMessage } from "@/session/transcript"

describe("SidechainTranscript", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "liteai-transcript-test-"))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("should resolve correct path", () => {
    const p = SidechainTranscript.getPath("/base", "sess-123", "sub1", "agent-foo")
    // Windows normalization:
    const expected = path.join("/base", "sess-123", "subagents", "sub1", "agent-agent-foo.jsonl")
    expect(p).toBe(expected)
  })

  it("should record message and create jsonl", async () => {
    const transcript = SidechainTranscript.create(tempDir, "session1", "groupA", "agent1")
    const msg: TranscriptMessage = {
      isSidechain: true,
      uuid: "u1",
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    }
    await transcript.recordMessage(msg)

    const content = await fs.readFile(transcript.getPath(), "utf-8")
    const parsed = JSON.parse(content.trim())
    expect(parsed.uuid).toBe("u1")
    expect(parsed.isSidechain).toBe(true)
  })

  it("should batch record chains", async () => {
    const transcript = SidechainTranscript.create(tempDir, "session2", "groupA", "agent2")
    const msgs: TranscriptMessage[] = [
      { isSidechain: true, uuid: "u1", role: "user", content: "hello", timestamp: 1 },
      { isSidechain: true, uuid: "u2", role: "assistant", content: "world", timestamp: 2 },
    ]
    await transcript.recordChain(msgs)

    const content = await fs.readFile(transcript.getPath(), "utf-8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] || "{}").uuid).toBe("u1")
    expect(JSON.parse(lines[1] || "{}").uuid).toBe("u2")
  })

  // Test to satisfy "concurrent write isolation"
  it("should handle concurrent writes", async () => {
    const transcript = SidechainTranscript.create(tempDir, "session3", "groupB", "agent3")
    const promises = Array.from({ length: 50 }).map((_, i) =>
      transcript.recordMessage({
        isSidechain: true,
        uuid: `u${i}`,
        role: "assistant",
        content: `Concurrent ${i}`,
        timestamp: Date.now(),
      }),
    )
    await Promise.all(promises)

    const content = await fs.readFile(transcript.getPath(), "utf-8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(50)
  })

  // TODO: Parent context growth verification
  it.skip("should verify parent context growth (delta is exactly 1 task_result block per SC-005)", () => {
    // TODO: An integration test must be wired to run the dense task context mapping before enabling the assertion.
    // This requires invoking the real transcript/session flow that spawns subagents,
    // capturing the actual initial parent context count and post-run parent context count
    // via the session/transcript APIs used elsewhere in tests, then asserting postCount - initialCount === 1.
  })
})
