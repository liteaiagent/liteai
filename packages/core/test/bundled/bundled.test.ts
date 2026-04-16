import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Bundled } from "../../src/bundled"

describe("Bundled", () => {
  // ----- Directory helpers -----

  test("agentsDir() returns an absolute path ending with /bundled/agents", () => {
    const dir = Bundled.agentsDir()
    expect(path.isAbsolute(dir)).toBe(true)
    expect(dir.replaceAll("\\", "/")).toMatch(/bundled\/agents$/)
  })

  test("skillsDir() returns an absolute path ending with /bundled/skills", () => {
    const dir = Bundled.skillsDir()
    expect(path.isAbsolute(dir)).toBe(true)
    expect(dir.replaceAll("\\", "/")).toMatch(/bundled\/skills$/)
  })

  test("commandsDir() returns an absolute path ending with /bundled/commands", () => {
    const dir = Bundled.commandsDir()
    expect(path.isAbsolute(dir)).toBe(true)
    expect(dir.replaceAll("\\", "/")).toMatch(/bundled\/commands$/)
  })

  // ----- Directory existence -----

  test("agentsDir() exists on disk", async () => {
    const stat = await fs.stat(Bundled.agentsDir())
    expect(stat.isDirectory()).toBe(true)
  })

  test("skillsDir() exists on disk", async () => {
    const stat = await fs.stat(Bundled.skillsDir())
    expect(stat.isDirectory()).toBe(true)
  })

  test("commandsDir() exists on disk", async () => {
    const stat = await fs.stat(Bundled.commandsDir())
    expect(stat.isDirectory()).toBe(true)
  })

  // ----- Agent reads -----

  const EXPECTED_AGENTS = [
    "plan",
    "build",
    "general",
    "explore",
    "plan-explore",
    "compaction",
    "title",
    "summary",
  ] as const

  for (const name of EXPECTED_AGENTS) {
    test(`agent("${name}") reads file successfully`, async () => {
      const content = await Bundled.agent(name)
      expect(typeof content).toBe("string")
      expect(content.length).toBeGreaterThan(0)
    })
  }

  test("agent() files contain YAML frontmatter", async () => {
    for (const name of EXPECTED_AGENTS) {
      const content = await Bundled.agent(name)
      // YAML frontmatter starts with ---
      expect(content.trimStart().startsWith("---")).toBe(true)
    }
  })

  test("agent() throws for non-existent agent", async () => {
    await expect(Bundled.agent("nonexistent-agent-xyz")).rejects.toThrow()
  })

  // ----- Command reads -----

  test('command("initialize") reads file successfully', async () => {
    const content = await Bundled.command("initialize")
    expect(typeof content).toBe("string")
    expect(content.length).toBeGreaterThan(0)
    // Should contain the AGENTS.md reference
    expect(content).toContain("AGENTS.md")
  })

  test('command("review") reads file successfully', async () => {
    const content = await Bundled.command("review")
    expect(typeof content).toBe("string")
    expect(content.length).toBeGreaterThan(0)
    // Should contain review-specific content
    expect(content).toContain("$ARGUMENTS")
  })

  test("command() throws for non-existent command", async () => {
    await expect(Bundled.command("nonexistent-cmd-xyz")).rejects.toThrow()
  })

  // ----- System prompt reads -----

  test("systemMd() reads file successfully", async () => {
    const content = await Bundled.systemMd()
    expect(typeof content).toBe("string")
    expect(content.length).toBeGreaterThan(0)
  })

  // ----- Misc prompt reads -----

  test('miscPrompt("max-steps") reads file successfully', async () => {
    const content = await Bundled.miscPrompt("max-steps")
    expect(typeof content).toBe("string")
    expect(content.length).toBeGreaterThan(0)
  })

  test("miscPrompt() throws for non-existent prompt", async () => {
    await expect(Bundled.miscPrompt("nonexistent-misc-xyz")).rejects.toThrow()
  })

  // ----- Agent prompt reads -----

  test('agentPrompt("generate") reads file successfully', async () => {
    const content = await Bundled.agentPrompt("generate")
    expect(typeof content).toBe("string")
    expect(content.length).toBeGreaterThan(0)
  })

  test("agentPrompt() throws for non-existent prompt", async () => {
    await expect(Bundled.agentPrompt("nonexistent-agent-prompt-xyz")).rejects.toThrow()
  })

  // ----- Completeness: all expected files present -----

  test("agentsDir() contains exactly the expected agent files", async () => {
    const files = await fs.readdir(Bundled.agentsDir())
    const mdFiles = files.filter((f) => f.endsWith(".md")).sort()
    const expected = [...EXPECTED_AGENTS].map((n) => `${n}.md`).sort()
    expect(mdFiles).toEqual(expected)
  })

  test("skillsDir() contains debug and simplify subdirectories", async () => {
    const entries = await fs.readdir(Bundled.skillsDir())
    expect(entries).toContain("debug")
    expect(entries).toContain("simplify")
  })

  test("each bundled skill has a SKILL.md file", async () => {
    for (const skill of ["debug", "simplify"]) {
      const skillFile = path.join(Bundled.skillsDir(), skill, "SKILL.md")
      const stat = await fs.stat(skillFile)
      expect(stat.isFile()).toBe(true)
    }
  })

  test("commandsDir() contains initialize.md and review.md", async () => {
    const files = await fs.readdir(Bundled.commandsDir())
    expect(files).toContain("initialize.md")
    expect(files).toContain("review.md")
  })
})
