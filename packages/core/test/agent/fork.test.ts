import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  buildChildMessage,
  buildForkedMessages,
  buildWorktreeNotice,
  FORK_BOILERPLATE_TAG,
  FORK_DIRECTIVE_PREFIX,
  ForkAgentConfig,
  isForkSubagentEnabled,
  isInForkChild,
} from "../../src/agent/fork"
import type { TranscriptMessage } from "../../src/session/transcript"

/**
 * Lightweight type for transcript content blocks in test assertions.
 * Covers the shapes produced by buildForkedMessages: text blocks, tool_result
 * blocks, and tool_use blocks — without pulling in Vercel AI SDK types.
 */
interface ContentBlock {
  type: string
  text?: string
  tool_use_id?: string
  content?: ContentBlock[]
}

// ─── isForkSubagentEnabled ────────────────────────────────────────────────────

describe("isForkSubagentEnabled", () => {
  // Key-level save/restore — never reassign process.env itself because it is a
  // native proxy object; replacing it detaches native env reads and leaks across
  // parallel test suites.
  const ENV_KEY = "LITEAI_FORK_SUBAGENT"
  let savedValue: string | undefined

  beforeEach(() => {
    savedValue = process.env[ENV_KEY]
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    if (savedValue === undefined) {
      delete process.env[ENV_KEY]
    } else {
      process.env[ENV_KEY] = savedValue
    }
  })

  it("returns false when LITEAI_FORK_SUBAGENT flag is not set", () => {
    delete process.env.LITEAI_FORK_SUBAGENT
    expect(isForkSubagentEnabled()).toBe(false)
  })

  it("returns true when flag is set and no exclusions apply", () => {
    process.env.LITEAI_FORK_SUBAGENT = "1"
    expect(isForkSubagentEnabled()).toBe(true)
  })

  it("returns true with explicit empty context", () => {
    process.env.LITEAI_FORK_SUBAGENT = "1"
    expect(isForkSubagentEnabled({})).toBe(true)
  })

  it("returns false when coordinator mode is active", () => {
    process.env.LITEAI_FORK_SUBAGENT = "1"
    expect(isForkSubagentEnabled({ isCoordinator: true })).toBe(false)
  })

  it("returns false when session is non-interactive", () => {
    process.env.LITEAI_FORK_SUBAGENT = "1"
    expect(isForkSubagentEnabled({ isNonInteractive: true })).toBe(false)
  })

  it("returns false when both coordinator and non-interactive are active", () => {
    process.env.LITEAI_FORK_SUBAGENT = "1"
    expect(isForkSubagentEnabled({ isCoordinator: true, isNonInteractive: true })).toBe(false)
  })

  it("returns false when flag is explicitly false", () => {
    process.env.LITEAI_FORK_SUBAGENT = "false"
    expect(isForkSubagentEnabled()).toBe(false)
  })
})

// ─── isInForkChild ────────────────────────────────────────────────────────────

describe("isInForkChild", () => {
  it("detects fork boilerplate tag in string content", () => {
    const messages: TranscriptMessage[] = [
      {
        isSidechain: true,
        uuid: "1",
        role: "user",
        content: `<${FORK_BOILERPLATE_TAG}>some rules</${FORK_BOILERPLATE_TAG}>`,
        timestamp: Date.now(),
      },
    ]
    expect(isInForkChild(messages)).toBe(true)
  })

  it("detects fork boilerplate tag in array content text blocks", () => {
    const messages: TranscriptMessage[] = [
      {
        isSidechain: true,
        uuid: "1",
        role: "user",
        content: [
          {
            type: "text",
            text: `<${FORK_BOILERPLATE_TAG}>rules here</${FORK_BOILERPLATE_TAG}>\nYour directive: do something`,
          },
        ],
        timestamp: Date.now(),
      },
    ]
    expect(isInForkChild(messages)).toBe(true)
  })

  it("returns false when no fork boilerplate tag is present", () => {
    const messages: TranscriptMessage[] = [
      {
        isSidechain: true,
        uuid: "1",
        role: "user",
        content: "A normal user message without any fork tags",
        timestamp: Date.now(),
      },
      {
        isSidechain: true,
        uuid: "2",
        role: "assistant",
        content: "I'll help you with that.",
        timestamp: Date.now(),
      },
    ]
    expect(isInForkChild(messages)).toBe(false)
  })

  it("ignores fork tag in non-user messages", () => {
    const messages: TranscriptMessage[] = [
      {
        isSidechain: true,
        uuid: "1",
        role: "assistant",
        content: `<${FORK_BOILERPLATE_TAG}>this should be ignored</${FORK_BOILERPLATE_TAG}>`,
        timestamp: Date.now(),
      },
    ]
    expect(isInForkChild(messages)).toBe(false)
  })

  it("returns false for empty messages array", () => {
    expect(isInForkChild([])).toBe(false)
  })

  it("returns false for messages with non-text content blocks", () => {
    const messages: TranscriptMessage[] = [
      {
        isSidechain: true,
        uuid: "1",
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "123", content: "result" }],
        timestamp: Date.now(),
      },
    ]
    expect(isInForkChild(messages)).toBe(false)
  })
})

// ─── buildChildMessage ────────────────────────────────────────────────────────

describe("buildChildMessage", () => {
  const directive = "Analyze the database schema in src/models/"

  it("wraps content in fork boilerplate tags", () => {
    const result = buildChildMessage(directive)
    expect(result).toContain(`<${FORK_BOILERPLATE_TAG}>`)
    expect(result).toContain(`</${FORK_BOILERPLATE_TAG}>`)
  })

  it("contains all 10 non-negotiable rules", () => {
    const result = buildChildMessage(directive)
    for (let i = 1; i <= 10; i++) {
      expect(result).toContain(`${i}.`)
    }
  })

  it("contains the 'STOP. READ THIS FIRST.' header", () => {
    const result = buildChildMessage(directive)
    expect(result).toContain("STOP. READ THIS FIRST.")
  })

  it("contains the worker identity declaration", () => {
    const result = buildChildMessage(directive)
    expect(result).toContain("You are a forked worker process. You are NOT the main agent.")
  })

  it("includes the structured output format", () => {
    const result = buildChildMessage(directive)
    expect(result).toContain("Scope:")
    expect(result).toContain("Result:")
    expect(result).toContain("Key files:")
    expect(result).toContain("Files changed:")
    expect(result).toContain("Issues:")
  })

  it("includes the 500 word report constraint", () => {
    const result = buildChildMessage(directive)
    expect(result).toContain("500 words")
  })

  it("appends directive with FORK_DIRECTIVE_PREFIX", () => {
    const result = buildChildMessage(directive)
    expect(result).toContain(`${FORK_DIRECTIVE_PREFIX}${directive}`)
  })

  it("places directive after the closing boilerplate tag", () => {
    const result = buildChildMessage(directive)
    const closingTagIdx = result.indexOf(`</${FORK_BOILERPLATE_TAG}>`)
    const directiveIdx = result.indexOf(directive)
    expect(directiveIdx).toBeGreaterThan(closingTagIdx)
  })

  it("includes the anti-forking rule (rule 1)", () => {
    const result = buildChildMessage(directive)
    expect(result).toContain("Do NOT spawn sub-agents; execute directly")
  })

  it("includes the commit rule (rule 5)", () => {
    const result = buildChildMessage(directive)
    expect(result).toContain("commit your changes before reporting")
  })

  it("produces identical contract text for different directives", () => {
    const contract1 = buildChildMessage("task A")
    const contract2 = buildChildMessage("task B")
    // Everything before the directive should be identical
    const prefix1 = contract1.slice(0, contract1.indexOf(FORK_DIRECTIVE_PREFIX))
    const prefix2 = contract2.slice(0, contract2.indexOf(FORK_DIRECTIVE_PREFIX))
    expect(prefix1).toBe(prefix2)
  })
})

// ─── buildForkedMessages ──────────────────────────────────────────────────────

describe("buildForkedMessages", () => {
  function makeAssistantMessage(toolUseBlocks: Array<{ id: string }>): TranscriptMessage {
    return {
      isSidechain: true,
      uuid: "parent-assistant-uuid",
      role: "assistant",
      content: [
        { type: "text", text: "I'll help you with that." },
        ...toolUseBlocks.map((b) => ({
          type: "tool_use" as const,
          id: b.id,
          name: "read_file",
          input: { path: "/some/file.ts" },
        })),
      ],
      timestamp: Date.now(),
    }
  }

  it("produces 2 messages when tool_use blocks are present", () => {
    const assistant = makeAssistantMessage([{ id: "tu-1" }, { id: "tu-2" }])
    const result = buildForkedMessages("do something", assistant)
    expect(result).toHaveLength(2)
    expect(result[0].role).toBe("assistant")
    expect(result[1].role).toBe("user")
  })

  it("clones the assistant message with a new UUID", () => {
    const assistant = makeAssistantMessage([{ id: "tu-1" }])
    const result = buildForkedMessages("do something", assistant)
    expect(result[0].uuid).not.toBe(assistant.uuid)
  })

  it("does not mutate the original assistant message", () => {
    const assistant = makeAssistantMessage([{ id: "tu-1" }])
    const originalContent = Array.isArray(assistant.content) ? [...assistant.content] : assistant.content
    buildForkedMessages("do something", assistant)
    expect(assistant.content).toEqual(originalContent)
  })

  it("creates tool_result placeholders with identical text for all tool_use blocks", () => {
    const assistant = makeAssistantMessage([{ id: "tu-1" }, { id: "tu-2" }, { id: "tu-3" }])
    const result = buildForkedMessages("do something", assistant)
    const userMsg = result[1]
    expect(Array.isArray(userMsg.content)).toBe(true)

    const contentArray = userMsg.content as ContentBlock[]
    const toolResults = contentArray.filter((b) => b.type === "tool_result")
    expect(toolResults).toHaveLength(3)

    // All placeholder texts must be identical for cache sharing
    const texts = toolResults.map((r) => r.content?.[0]?.text)
    expect(new Set(texts).size).toBe(1)
    expect(texts[0]).toBe("Fork started — processing in background")
  })

  it("includes the child directive as the last content block", () => {
    const assistant = makeAssistantMessage([{ id: "tu-1" }])
    const directive = "analyze the codebase"
    const result = buildForkedMessages(directive, assistant)
    const userMsg = result[1]
    const contentArray = userMsg.content as ContentBlock[]
    const lastBlock = contentArray[contentArray.length - 1]
    expect(lastBlock.type).toBe("text")
    expect(lastBlock.text).toContain(directive)
    expect(lastBlock.text).toContain(FORK_BOILERPLATE_TAG)
  })

  it("produces cache-compatible prefixes for sibling children (different directives)", () => {
    const assistant = makeAssistantMessage([{ id: "tu-1" }, { id: "tu-2" }])
    const result1 = buildForkedMessages("task A", assistant)
    const result2 = buildForkedMessages("task B", assistant)

    // The assistant message structure should be identical
    expect(Array.isArray(result1[0].content)).toBe(Array.isArray(result2[0].content))

    // The tool_result placeholder texts should be identical between siblings
    const user1Content = result1[1].content as ContentBlock[]
    const user2Content = result2[1].content as ContentBlock[]
    const results1 = user1Content.filter((b) => b.type === "tool_result")
    const results2 = user2Content.filter((b) => b.type === "tool_result")
    expect(results1.map((r) => r.content?.[0]?.text)).toEqual(results2.map((r) => r.content?.[0]?.text))

    // Only the final text block should differ
    const lastBlock1 = user1Content[user1Content.length - 1]
    const lastBlock2 = user2Content[user2Content.length - 1]
    expect(lastBlock1.text).not.toBe(lastBlock2.text)
    expect(lastBlock1.text).toContain("task A")
    expect(lastBlock2.text).toContain("task B")
  })

  it("falls back to directive-only message when no tool_use blocks exist", () => {
    const assistant: TranscriptMessage = {
      isSidechain: true,
      uuid: "parent-uuid",
      role: "assistant",
      content: [{ type: "text", text: "I have no tools to call." }],
      timestamp: Date.now(),
    }
    const result = buildForkedMessages("do something", assistant)
    // Fallback: only a user message with the directive
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe("user")
    const contentArray = result[0].content as ContentBlock[]
    expect(contentArray).toHaveLength(1)
    expect(contentArray[0].text).toContain(FORK_BOILERPLATE_TAG)
  })

  it("falls back to directive-only message for string content (no tool_use)", () => {
    const assistant: TranscriptMessage = {
      isSidechain: true,
      uuid: "parent-uuid",
      role: "assistant",
      content: "Just a string response with no tool calls",
      timestamp: Date.now(),
    }
    const result = buildForkedMessages("do something", assistant)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe("user")
  })

  it("produces unique UUIDs for each forked message", () => {
    const assistant = makeAssistantMessage([{ id: "tu-1" }])
    const result = buildForkedMessages("do something", assistant)
    const uuids = result.map((m) => m.uuid)
    expect(new Set(uuids).size).toBe(uuids.length)
  })
})

// ─── ForkAgentConfig ──────────────────────────────────────────────────────────

describe("ForkAgentConfig", () => {
  it("has agentType 'fork'", () => {
    expect(ForkAgentConfig.agentType).toBe("fork")
  })

  it("uses wildcard tools for cache-identical tool pool", () => {
    expect(ForkAgentConfig.tools).toBe("*")
  })

  it("has maxTurns of 200", () => {
    expect(ForkAgentConfig.maxTurns).toBe(200)
  })

  it("inherits parent model", () => {
    expect(ForkAgentConfig.model).toBe("inherit")
  })

  it("defaults to bubble permission mode", () => {
    expect(ForkAgentConfig.permissionMode).toBe("bubble")
  })

  it("has 30 minute wall clock timeout", () => {
    expect(ForkAgentConfig.wallClockTimeout).toBe(1_800_000)
  })

  it("is always a background agent", () => {
    expect(ForkAgentConfig.background).toBe(true)
  })

  it("is a built-in source", () => {
    expect(ForkAgentConfig.source).toBe("builtIn")
  })
})

// ─── Constants ────────────────────────────────────────────────────────────────

describe("fork constants", () => {
  it("FORK_BOILERPLATE_TAG matches MVP value", () => {
    expect(FORK_BOILERPLATE_TAG).toBe("fork-boilerplate")
  })

  it("FORK_DIRECTIVE_PREFIX matches MVP value", () => {
    expect(FORK_DIRECTIVE_PREFIX).toBe("Your directive: ")
  })
})

// ─── buildWorktreeNotice ──────────────────────────────────────────────────────

describe("buildWorktreeNotice", () => {
  it("includes parent CWD in the output", () => {
    const notice = buildWorktreeNotice("/parent/project", "/worktree/branch-a")
    expect(notice).toContain("/parent/project")
  })

  it("includes worktree path in the output", () => {
    const notice = buildWorktreeNotice("/parent/project", "/worktree/branch-a")
    expect(notice).toContain("/worktree/branch-a")
  })

  it("mentions re-reading files from the worktree", () => {
    const notice = buildWorktreeNotice("/parent", "/wt")
    // The notice should guide the agent to re-read files from the isolated directory
    expect(notice.toLowerCase()).toMatch(/re-?read|read.*again|fresh/)
  })

  it("mentions isolation semantics", () => {
    const notice = buildWorktreeNotice("/parent", "/wt")
    // The notice should explain the worktree is an isolated copy
    expect(notice.toLowerCase()).toMatch(/isolat|separate|independent|copy/)
  })

  it("returns a non-empty string", () => {
    const notice = buildWorktreeNotice("/a", "/b")
    expect(notice.length).toBeGreaterThan(0)
  })
})
