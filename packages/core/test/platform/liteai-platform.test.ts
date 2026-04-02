import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

let prev: string | undefined
beforeAll(() => {
  prev = process.env.LITEAI_PLATFORM
  delete process.env.LITEAI_PLATFORM
})
afterAll(() => {
  if (prev !== undefined) process.env.LITEAI_PLATFORM = prev
})

test("does NOT discover from .claude/agents/ directory when platform is unset", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const agentDir = path.join(dir, ".claude", "agents")
      await fs.mkdir(agentDir, { recursive: true })
      await Bun.write(
        path.join(agentDir, "reviewer.md"),
        `---
description: Reviews code for quality
---

You are a code reviewer.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("reviewer")
      expect(agent).toBeUndefined()
    },
  })
})

test("does NOT discover from .agents/agents/ directory when platform is unset", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const agentDir = path.join(dir, ".agents", "agents")
      await fs.mkdir(agentDir, { recursive: true })
      await Bun.write(
        path.join(agentDir, "worker.md"),
        `---
description: A worker agent
---

You are a worker.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("worker")
      expect(agent).toBeUndefined()
    },
  })
})
