import { describe, expect, test } from "bun:test"
import path from "node:path"
import { AgentLoader } from "../../src/agent/loader"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("AgentLoader.parseAgent", () => {
  test("parses a valid agent config with frontmatter and prompt", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "agents", "my-agent.md")

        // Create necessary agent file
        await Bun.write(
          filePath,
          `---
description: Test agent
mode: subagent
---

You are a test agent.
`,
        )

        const result = await AgentLoader.parseAgentFromMarkdown(filePath)
        expect(result).toBeDefined()
        if (!result) return

        const [name, config] = result
        expect(name).toBe("my-agent")
        expect(config.description).toBe("Test agent")
        expect(config.mode).toBe("subagent")
        expect(config.prompt).toBe("You are a test agent.")
      },
    })
  })

  test("handles name extraction with nested directories under agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "agents", "nested", "custom.md")

        await Bun.write(
          filePath,
          `---
description: Nested agent
---
Prompt here.
`,
        )

        const result = await AgentLoader.parseAgentFromMarkdown(filePath)
        expect(result).toBeDefined()
        if (!result) return

        const [name, _config] = result
        expect(name).toBe("nested/custom")
      },
    })
  })

  test("returns undefined for invalid frontmatter schema", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "agents", "invalid.md")

        await Bun.write(
          filePath,
          `---
description: 123
mode: unknown_mode
---
Prompt here.
`,
        )

        const result = await AgentLoader.parseAgentFromMarkdown(filePath)
        expect(result).toBeUndefined()
      },
    })
  })

  test("returns undefined if file doesn't exist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "agents", "nonexistent.md")

        const result = await AgentLoader.parseAgentFromMarkdown(filePath)
        expect(result).toBeUndefined()
      },
    })
  })
})

describe("AgentLoader.loadAgent", () => {
  test("loads multiple agent files correctly from deeply nested paths", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(
          path.join(tmp.path, "agents", "foo.md"),
          `---
description: Foo agent
---
Foo prompt
`,
        )

        await Bun.write(
          path.join(tmp.path, "agents", "deep", "bar.md"),
          `---
description: Bar agent
---
Bar prompt
`,
        )

        const result = await AgentLoader.loadAgent(tmp.path)
        expect(Object.keys(result)).toHaveLength(2)

        expect(result.foo).toBeDefined()
        expect(result.foo?.description).toBe("Foo agent")

        expect(result["deep/bar"]).toBeDefined()
        expect(result["deep/bar"]?.description).toBe("Bar agent")
      },
    })
  })
})

describe("AgentLoader.scanAgents", () => {
  test("scans only exact patterns and handles platform scope", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(
          path.join(tmp.path, "agents", "global1.md"),
          `---
description: Global agent 1
---
Global prompt
`,
        )

        // Subdirectories shouldn't be matched by scanAgents (it uses agents/*.md)
        await Bun.write(
          path.join(tmp.path, "agents", "ignore", "global2.md"),
          `---
description: Global agent 2
---
Global prompt
`,
        )

        const result = await AgentLoader.scanAgents(tmp.path, "global")
        expect(Object.keys(result)).toHaveLength(1)

        expect(result.global1).toBeDefined()
        expect(result["ignore/global2"]).toBeUndefined()
      },
    })
  })
})
