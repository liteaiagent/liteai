import { describe, expect, spyOn, test } from "bun:test"
import { Log } from "@liteai/util/log"
import type { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import type { ModelID, ProviderID } from "../../src/provider/schema"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"

describe("ToolRegistry (T051)", () => {
  const dummyModel = { providerID: "test" as ProviderID, modelID: "test-model" as ModelID }

  test("returns full tool pool when disallowedTools is undefined", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defaultTools = await ToolRegistry.tools(dummyModel)
        const agent = { name: "test-agent", disallowedTools: undefined, permission: [] } as unknown as Agent.Info
        const filteredTools = await ToolRegistry.tools(dummyModel, agent)
        expect(filteredTools.length).toBe(defaultTools.length)
      },
    })
  })

  test("returns full tool pool when disallowedTools is empty list", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defaultTools = await ToolRegistry.tools(dummyModel)
        const agent = { name: "test-agent", disallowedTools: [], permission: [] } as unknown as Agent.Info
        const filteredTools = await ToolRegistry.tools(dummyModel, agent)
        expect(filteredTools.length).toBe(defaultTools.length)
      },
    })
  })

  test("removes tools specified in disallowedTools", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defaultTools = await ToolRegistry.tools(dummyModel)
        const hasWrite = defaultTools.some((t) => t.id === "write")
        const hasEdit = defaultTools.some((t) => t.id === "edit")
        expect(hasWrite).toBe(true)
        expect(hasEdit).toBe(true)

        const agent = {
          name: "test-agent",
          disallowedTools: ["write", "edit"],
          permission: [],
        } as unknown as Agent.Info
        const filteredTools = await ToolRegistry.tools(dummyModel, agent)

        expect(filteredTools.length).toBe(defaultTools.length - 2)

        const filteredIds = filteredTools.map((t) => t.id)
        expect(filteredIds).not.toContain("write")
        expect(filteredIds).not.toContain("edit")
        expect(filteredIds).toContain("run_command")
      },
    })
  })

  test("logs structured warning if disallowedTools entry does not match...", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = {
          name: "warning-agent",
          disallowedTools: ["non_existent_tool_123"],
          permission: [],
        } as unknown as Agent.Info

        const logger = Log.create({ service: "agent" })
        const warnSpy = spyOn(logger, "warn")

        const tools = await ToolRegistry.tools(dummyModel, agent)
        const filteredIds = tools.map((t) => t.id)
        expect(filteredIds).toContain("run_command")

        expect(warnSpy).toHaveBeenCalled()
        const warnCall = warnSpy.mock.calls.find(
          (call) => typeof call[0] === "string" && call[0].includes("non_existent_tool_123"),
        )
        expect(warnCall).toBeDefined()
        expect(warnCall?.[1]).toEqual({ agent: "warning-agent", tool: "non_existent_tool_123" })

        warnSpy.mockRestore()
      },
    })
  })
})
