import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Skill } from "../../src/skill"
import { tmpdir } from "../fixture/fixture"

let prevPlatform: string | undefined

beforeAll(() => {
  prevPlatform = process.env.LITEAI_PLATFORM
  process.env.LITEAI_PLATFORM = "standard"
})

afterAll(() => {
  if (prevPlatform !== undefined) process.env.LITEAI_PLATFORM = prevPlatform
  else delete process.env.LITEAI_PLATFORM
})

async function createGlobalSkill(homeDir: string) {
  const skillDir = path.join(homeDir, ".agents", "skills", "global-test-skill")
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: global-test-skill
description: A global skill from ~/.agents/skills for testing.
---

# Global Test Skill

This skill is loaded from the global home directory.
`,
  )
}

test("discovers skills from .agents/skills/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".agents", "skills", "agent-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      const agentSkill = skills.find((s) => s.name === "agent-skill")
      expect(agentSkill).toBeDefined()
      expect(agentSkill?.location).toContain(path.join(".agents", "skills", "agent-skill", "SKILL.md"))
    },
  })
}, 30_000)

test("discovers global skills from ~/.agents/skills/ directory", async () => {
  await using tmp = await tmpdir({ git: true })

  const originalHome = process.env.LITEAI_TEST_HOME
  process.env.LITEAI_TEST_HOME = tmp.path

  try {
    await createGlobalSkill(tmp.path)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        const skill = skills.find((s) => s.name === "global-test-skill")
        expect(skill).toBeDefined()
        expect(skill?.description).toBe("A global skill from ~/.agents/skills for testing.")
        expect(skill?.location).toContain(path.join(".agents", "skills", "global-test-skill", "SKILL.md"))
      },
    })
  } finally {
    process.env.LITEAI_TEST_HOME = originalHome
  }
}, 30_000)

test("discovers skills from .agents/skills/ but ignores .claude/skills/ when platform is standard", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const claudeDir = path.join(dir, ".claude", "skills", "claude-skill")
      const agentDir = path.join(dir, ".agents", "skills", "agent-skill")
      await Bun.write(
        path.join(claudeDir, "SKILL.md"),
        `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )
      await Bun.write(
        path.join(agentDir, "SKILL.md"),
        `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.find((s) => s.name === "agent-skill")).toBeDefined()
      expect(skills.find((s) => s.name === "claude-skill")).toBeUndefined()
    },
  })
}, 30_000)
