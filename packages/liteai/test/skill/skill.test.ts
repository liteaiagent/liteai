import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Flag } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"
import { Skill } from "../../src/skill"
import { tmpdir } from "../fixture/fixture"

let prevExternalSkills: boolean

beforeAll(() => {
  prevExternalSkills = Flag.LITEAI_DISABLE_EXTERNAL_SKILLS
  // @ts-expect-error - Mutating namespace property for testing external skills
  Flag.LITEAI_DISABLE_EXTERNAL_SKILLS = false
})

afterAll(() => {
  // @ts-expect-error - Restore original state
  Flag.LITEAI_DISABLE_EXTERNAL_SKILLS = prevExternalSkills
})

async function createGlobalSkill(homeDir: string) {
  const skillDir = path.join(homeDir, ".claude", "skills", "global-test-skill")
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: global-test-skill
description: A global skill from ~/.claude/skills for testing.
---

# Global Test Skill

This skill is loaded from the global home directory.
`,
  )
}

test("discovers skills from .liteai/skill/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".liteai", "skill", "test-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: test-skill
description: A test skill for verification.
---

# Test Skill

Instructions here.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      const testSkill = skills.find((s) => s.name === "test-skill")
      expect(testSkill).toBeDefined()
      expect(testSkill?.description).toBe("A test skill for verification.")
      expect(testSkill?.location).toContain(path.join("skill", "test-skill", "SKILL.md"))
    },
  })
})

test("returns skill directories from Skill.dirs", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".liteai", "skill", "dir-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: dir-skill
description: Skill for dirs test.
---

# Dir Skill
`,
      )
    },
  })

  const home = process.env.LITEAI_TEST_HOME
  process.env.LITEAI_TEST_HOME = tmp.path

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dirs = await Skill.dirs()
        const skillDir = path.join(tmp.path, ".liteai", "skill", "dir-skill")
        expect(dirs).toContain(skillDir)
      },
    })
  } finally {
    process.env.LITEAI_TEST_HOME = home
  }
})

test("discovers multiple skills from .liteai/skill/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir1 = path.join(dir, ".liteai", "skill", "skill-one")
      const skillDir2 = path.join(dir, ".liteai", "skill", "skill-two")
      await Bun.write(
        path.join(skillDir1, "SKILL.md"),
        `---
name: skill-one
description: First test skill.
---

# Skill One
`,
      )
      await Bun.write(
        path.join(skillDir2, "SKILL.md"),
        `---
name: skill-two
description: Second test skill.
---

# Skill Two
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.find((s) => s.name === "skill-one")).toBeDefined()
      expect(skills.find((s) => s.name === "skill-two")).toBeDefined()
    },
  })
})

test("skips skills with missing frontmatter", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".liteai", "skill", "no-frontmatter")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `# No Frontmatter

Just some content without YAML frontmatter.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      // The no-frontmatter skill is skipped; only bundled skills present
      expect(skills.find((s) => s.name === "no-frontmatter")).toBeUndefined()
    },
  })
})

test("discovers skills from .claude/skills/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".claude", "skills", "claude-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      const claudeSkill = skills.find((s) => s.name === "claude-skill")
      expect(claudeSkill).toBeDefined()
      expect(claudeSkill?.location).toContain(path.join(".claude", "skills", "claude-skill", "SKILL.md"))
    },
  })
})

test("discovers global skills from ~/.claude/skills/ directory", async () => {
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
        expect(skill?.description).toBe("A global skill from ~/.claude/skills for testing.")
        expect(skill?.location).toContain(path.join(".claude", "skills", "global-test-skill", "SKILL.md"))
      },
    })
  } finally {
    process.env.LITEAI_TEST_HOME = originalHome
  }
})

test("returns empty array when no skills exist", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      // Only bundled skills should be present when no user/project skills exist
      const names = skills.map((s) => s.name)
      expect(names.every((n) => ["debug", "simplify"].includes(n))).toBe(true)
    },
  })
})

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
})

test("discovers global skills from ~/.agents/skills/ directory", async () => {
  await using tmp = await tmpdir({ git: true })

  const originalHome = process.env.LITEAI_TEST_HOME
  process.env.LITEAI_TEST_HOME = tmp.path

  try {
    const skillDir = path.join(tmp.path, ".agents", "skills", "global-agent-skill")
    await fs.mkdir(skillDir, { recursive: true })
    await Bun.write(
      path.join(skillDir, "SKILL.md"),
      `---
name: global-agent-skill
description: A global skill from ~/.agents/skills for testing.
---

# Global Agent Skill

This skill is loaded from the global home directory.
`,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        const skill = skills.find((s) => s.name === "global-agent-skill")
        expect(skill).toBeDefined()
        expect(skill?.description).toBe("A global skill from ~/.agents/skills for testing.")
        expect(skill?.location).toContain(path.join(".agents", "skills", "global-agent-skill", "SKILL.md"))
      },
    })
  } finally {
    process.env.LITEAI_TEST_HOME = originalHome
  }
})

test("discovers skills from both .claude/skills/ and .agents/skills/", async () => {
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
      expect(skills.find((s) => s.name === "claude-skill")).toBeDefined()
      expect(skills.find((s) => s.name === "agent-skill")).toBeDefined()
    },
  })
})

test("properly resolves directories that skills live in", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const liteaiSkillDir = path.join(dir, ".liteai", "skill", "agent-skill")
      const liteaiSkillsDir = path.join(dir, ".liteai", "skills", "agent-skill")
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
      await Bun.write(
        path.join(liteaiSkillDir, "SKILL.md"),
        `---
name: liteai-skill
description: A skill in the .liteai/skill directory.
---

# LiteAI Skill
`,
      )
      await Bun.write(
        path.join(liteaiSkillsDir, "SKILL.md"),
        `---
name: liteai-skill
description: A skill in the .liteai/skills directory.
---

# LiteAI Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const dirs = await Skill.dirs()
      expect(dirs.length).toBeGreaterThanOrEqual(4)
    },
  })
})

test("parses advanced frontmatter fields (kebab-case)", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".liteai", "skill", "advanced-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: advanced-skill
description: Tests advanced frontmatter.
argument-hint: "[issue-number]"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Grep, Glob
model: sonnet
context: fork
agent: Explore
---

# Advanced Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("advanced-skill")
      expect(skill).toBeDefined()
      expect(skill?.argument_hint).toBe("[issue-number]")
      expect(skill?.disable_model_invocation).toBe(true)
      expect(skill?.user_invocable).toBe(true)
      expect(skill?.allowed_tools).toBe("Read, Grep, Glob")
      expect(skill?.model).toBe("sonnet")
      expect(skill?.context).toBe("fork")
      expect(skill?.agent).toBe("Explore")
    },
  })
})

test("parses snake_case frontmatter fields", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".liteai", "skill", "snake-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: snake-skill
description: Tests snake_case fields.
argument_hint: "[path]"
disable_model_invocation: true
user_invocable: false
allowed_tools: Bash
---

# Snake Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("snake-skill")
      expect(skill).toBeDefined()
      expect(skill?.argument_hint).toBe("[path]")
      expect(skill?.disable_model_invocation).toBe(true)
      expect(skill?.user_invocable).toBe(false)
    },
  })
})

test("available() filters by disable_model_invocation for model invoker", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const s1 = path.join(dir, ".liteai", "skill", "normal-skill")
      const s2 = path.join(dir, ".liteai", "skill", "user-only-skill")
      await Bun.write(
        path.join(s1, "SKILL.md"),
        `---
name: normal-skill
description: Available to both.
---
# Normal
`,
      )
      await Bun.write(
        path.join(s2, "SKILL.md"),
        `---
name: user-only-skill
description: Only user can invoke.
disable-model-invocation: true
---
# User Only
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = await Skill.available(undefined, "model")
      const user = await Skill.available(undefined, "user")
      expect(model.find((s) => s.name === "user-only-skill")).toBeUndefined()
      expect(model.find((s) => s.name === "normal-skill")).toBeDefined()
      expect(user.find((s) => s.name === "user-only-skill")).toBeDefined()
      expect(user.find((s) => s.name === "normal-skill")).toBeDefined()
    },
  })
})

test("available() filters by user_invocable for user invoker", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const s1 = path.join(dir, ".liteai", "skill", "visible-skill")
      const s2 = path.join(dir, ".liteai", "skill", "hidden-skill")
      await Bun.write(
        path.join(s1, "SKILL.md"),
        `---
name: visible-skill
description: User can invoke.
---
# Visible
`,
      )
      await Bun.write(
        path.join(s2, "SKILL.md"),
        `---
name: hidden-skill
description: Background knowledge only.
user-invocable: false
---
# Hidden
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const user = await Skill.available(undefined, "user")
      const model = await Skill.available(undefined, "model")
      expect(user.find((s) => s.name === "hidden-skill")).toBeUndefined()
      expect(user.find((s) => s.name === "visible-skill")).toBeDefined()
      expect(model.find((s) => s.name === "hidden-skill")).toBeDefined()
      expect(model.find((s) => s.name === "visible-skill")).toBeDefined()
    },
  })
})

test("fmt() includes argument_hint in output", () => {
  const list: Skill.Info[] = [
    {
      name: "test-skill",
      description: "A skill.",
      argument_hint: "[file-path]",
      location: "/tmp/test/SKILL.md",
      content: "# Test",
    },
    {
      name: "no-hint",
      description: "No hint.",
      location: "/tmp/test2/SKILL.md",
      content: "# No Hint",
    },
  ]
  const short = Skill.fmt(list, { verbose: false })
  expect(short).toContain("**test-skill** [file-path]: A skill.")
  expect(short).toContain("**no-hint**: No hint.")

  const verbose = Skill.fmt(list, { verbose: true })
  expect(verbose).toContain("<argument_hint>[file-path]</argument_hint>")
  expect(verbose).not.toContain("<argument_hint></argument_hint>")
})

test("advanced frontmatter optional fields default to undefined", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".liteai", "skill", "basic-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: basic-skill
description: Only basic fields.
---

# Basic
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("basic-skill")
      expect(skill).toBeDefined()
      expect(skill?.argument_hint).toBeUndefined()
      expect(skill?.disable_model_invocation).toBeUndefined()
      expect(skill?.user_invocable).toBeUndefined()
      expect(skill?.allowed_tools).toBeUndefined()
      expect(skill?.model).toBeUndefined()
      expect(skill?.context).toBeUndefined()
      expect(skill?.agent).toBeUndefined()
      expect(skill?.hooks).toBeUndefined()
    },
  })
})
