import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "../../src/agent/agent"
import * as Platform from "../../src/platform"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

/** Wrap Instance.provide inside a Platform.withOverride(null, …) scope (no platform). */
function withNoPlatform<R>(input: { directory: string; fn: () => R }): Promise<R> {
  return Platform.withOverride(null, () => Instance.provide(input))
}

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

  await withNoPlatform({
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

  await withNoPlatform({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("worker")
      expect(agent).toBeUndefined()
    },
  })
})
