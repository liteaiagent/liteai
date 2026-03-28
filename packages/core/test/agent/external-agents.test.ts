import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

let prev: string | undefined
beforeAll(() => {
  prev = process.env.LITEAI_ENABLE_CLAUDE_CODE
  process.env.LITEAI_ENABLE_CLAUDE_CODE = "true"
})
afterAll(() => {
  if (prev !== undefined) process.env.LITEAI_ENABLE_CLAUDE_CODE = prev
  else delete process.env.LITEAI_ENABLE_CLAUDE_CODE
})

test("discovers agents from .claude/agents/ directory", async () => {
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
      expect(agent).toBeDefined()
      expect(agent?.description).toBe("Reviews code for quality")
      expect(agent?.prompt).toBe("You are a code reviewer.")
      expect(agent?.native).toBe(false)
    },
  })
})

test("discovers agents from .agents/agents/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const agentDir = path.join(dir, ".agents", "agents")
      await fs.mkdir(agentDir, { recursive: true })
      await Bun.write(
        path.join(agentDir, "worker.md"),
        `---
description: A worker agent
mode: subagent
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
      expect(agent).toBeDefined()
      expect(agent?.description).toBe("A worker agent")
      expect(agent?.mode).toBe("subagent")
    },
  })
})

test("discovers global agents from ~/.claude/agents/", async () => {
  await using tmp = await tmpdir({ git: true })

  const home = process.env.LITEAI_TEST_HOME
  process.env.LITEAI_TEST_HOME = tmp.path

  try {
    const agentDir = path.join(tmp.path, ".claude", "agents")
    await fs.mkdir(agentDir, { recursive: true })
    await Bun.write(
      path.join(agentDir, "global-reviewer.md"),
      `---
description: A global reviewer
---

Global reviewer instructions.
`,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("global-reviewer")
        expect(agent).toBeDefined()
        expect(agent?.description).toBe("A global reviewer")
      },
    })
  } finally {
    process.env.LITEAI_TEST_HOME = home
  }
})

test("discovers global agents from ~/.agents/agents/", async () => {
  await using tmp = await tmpdir({ git: true })

  const home = process.env.LITEAI_TEST_HOME
  process.env.LITEAI_TEST_HOME = tmp.path

  try {
    const agentDir = path.join(tmp.path, ".agents", "agents")
    await fs.mkdir(agentDir, { recursive: true })
    await Bun.write(
      path.join(agentDir, "global-worker.md"),
      `---
description: A global worker
---

Global worker instructions.
`,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("global-worker")
        expect(agent).toBeDefined()
        expect(agent?.description).toBe("A global worker")
      },
    })
  } finally {
    process.env.LITEAI_TEST_HOME = home
  }
})

test("project agents override global external agents", async () => {
  // Use separate dirs for home and project so files don't collide
  await using home = await tmpdir()
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const projectDir = path.join(dir, ".claude", "agents")
      await fs.mkdir(projectDir, { recursive: true })
      await Bun.write(
        path.join(projectDir, "shared.md"),
        `---
description: Project version
---

Project shared agent.
`,
      )
    },
  })

  const prev = process.env.LITEAI_TEST_HOME
  process.env.LITEAI_TEST_HOME = home.path

  try {
    const globalDir = path.join(home.path, ".claude", "agents")
    await fs.mkdir(globalDir, { recursive: true })
    await Bun.write(
      path.join(globalDir, "shared.md"),
      `---
description: Global version
---

Global shared agent.
`,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("shared")
        expect(agent).toBeDefined()
        // Project-level should win over global
        expect(agent?.description).toBe("Project version")
      },
    })
  } finally {
    process.env.LITEAI_TEST_HOME = prev
  }
})

test("external agents default mode to all", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const agentDir = path.join(dir, ".claude", "agents")
      await fs.mkdir(agentDir, { recursive: true })
      await Bun.write(
        path.join(agentDir, "nomode.md"),
        `---
description: Agent without mode
---

No mode specified.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("nomode")
      expect(agent).toBeDefined()
      expect(agent?.mode).toBe("all")
    },
  })
})
