import { describe, expect, test } from "bun:test"
import { Message } from "../../src/session/message"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"

describe("structured-output.OutputFormat", () => {
  test("parses text format", () => {
    const result = Message.Format.safeParse({ type: "text" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("text")
    }
  })

  test("parses json_schema format with defaults", () => {
    const result = Message.Format.safeParse({
      type: "json_schema",
      schema: { type: "object", properties: { name: { type: "string" } } },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("json_schema")
      if (result.data.type === "json_schema") {
        expect(result.data.retryCount).toBe(2) // default value
      }
    }
  })

  test("parses json_schema format with custom retryCount", () => {
    const result = Message.Format.safeParse({
      type: "json_schema",
      schema: { type: "object" },
      retryCount: 5,
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.type === "json_schema") {
      expect(result.data.retryCount).toBe(5)
    }
  })

  test("rejects invalid type", () => {
    const result = Message.Format.safeParse({ type: "invalid" })
    expect(result.success).toBe(false)
  })

  test("rejects json_schema without schema", () => {
    const result = Message.Format.safeParse({ type: "json_schema" })
    expect(result.success).toBe(false)
  })

  test("rejects negative retryCount", () => {
    const result = Message.Format.safeParse({
      type: "json_schema",
      schema: { type: "object" },
      retryCount: -1,
    })
    expect(result.success).toBe(false)
  })
})

describe("structured-output.StructuredOutputError", () => {
  test("creates error with message and retries", () => {
    const error = new Message.StructuredOutputError({
      message: "Failed to validate",
      retries: 3,
    })

    expect(error.name).toBe("StructuredOutputError")
    expect(error.data.message).toBe("Failed to validate")
    expect(error.data.retries).toBe(3)
  })

  test("converts to object correctly", () => {
    const error = new Message.StructuredOutputError({
      message: "Test error",
      retries: 2,
    })

    const obj = error.toObject()
    expect(obj.name).toBe("StructuredOutputError")
    expect(obj.data.message).toBe("Test error")
    expect(obj.data.retries).toBe(2)
  })

  test("isInstance correctly identifies error", () => {
    const error = new Message.StructuredOutputError({
      message: "Test",
      retries: 1,
    })

    expect(Message.StructuredOutputError.isInstance(error)).toBe(true)
    expect(Message.StructuredOutputError.isInstance({ name: "other" })).toBe(false)
  })
})

describe("structured-output.UserMessage", () => {
  test("user message accepts outputFormat", () => {
    const result = Message.User.safeParse({
      id: MessageID.ascending(),
      sessionID: SessionID.descending(),
      role: "user",
      time: { created: Date.now() },
      agent: "default",
      model: { providerID: "anthropic", modelID: "claude-3" },
      outputFormat: {
        type: "json_schema",
        schema: { type: "object" },
      },
    })
    expect(result.success).toBe(true)
  })

  test("user message works without outputFormat (optional)", () => {
    const result = Message.User.safeParse({
      id: MessageID.ascending(),
      sessionID: SessionID.descending(),
      role: "user",
      time: { created: Date.now() },
      agent: "default",
      model: { providerID: "anthropic", modelID: "claude-3" },
    })
    expect(result.success).toBe(true)
  })
})

describe("structured-output.AssistantMessage", () => {
  const baseAssistantMessage = {
    id: MessageID.ascending(),
    sessionID: SessionID.descending(),
    role: "assistant" as const,
    parentID: MessageID.ascending(),
    modelID: "claude-3",
    providerID: "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/test", root: "/test" },
    cost: 0.001,
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now() },
  }

  test("assistant message accepts structured", () => {
    const result = Message.Assistant.safeParse({
      ...baseAssistantMessage,
      structured: { company: "Anthropic", founded: 2021 },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.structured).toEqual({ company: "Anthropic", founded: 2021 })
    }
  })

  test("assistant message works without structured_output (optional)", () => {
    const result = Message.Assistant.safeParse(baseAssistantMessage)
    expect(result.success).toBe(true)
  })
})

describe("structured-output.createStructuredOutputTool", () => {
  test("creates tool with correct id", () => {
    const tool = SessionPrompt.createStructuredOutputTool({
      schema: { type: "object", properties: { name: { type: "string" } } },
      onSuccess: () => {},
    })

    // AI SDK tool type doesn't expose id, but we set it internally
    expect((tool as Record<string, unknown>).id).toBe("StructuredOutput")
  })

  test("creates tool with description", () => {
    const tool = SessionPrompt.createStructuredOutputTool({
      schema: { type: "object" },
      onSuccess: () => {},
    })

    expect(tool.description).toContain("structured format")
  })

  test("creates tool with schema as inputSchema", () => {
    const schema = {
      type: "object",
      properties: {
        company: { type: "string" },
        founded: { type: "number" },
      },
      required: ["company"],
    }

    const tool = SessionPrompt.createStructuredOutputTool({
      schema,
      onSuccess: () => {},
    })

    // AI SDK wraps schema in { jsonSchema: {...} }
    expect(tool.inputSchema).toBeDefined()
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK FlexibleSchema needs any cast for test assertions
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.properties?.company).toBeDefined()
    expect(inputSchema.jsonSchema?.properties?.founded).toBeDefined()
  })

  test("strips $schema property from inputSchema", () => {
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { name: { type: "string" } },
    }

    const tool = SessionPrompt.createStructuredOutputTool({
      schema,
      onSuccess: () => {},
    })

    // AI SDK wraps schema in { jsonSchema: {...} }
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK FlexibleSchema needs any cast for test assertions
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.$schema).toBeUndefined()
  })

  test("execute calls onSuccess with valid args", async () => {
    let capturedOutput: unknown

    const tool = SessionPrompt.createStructuredOutputTool({
      schema: { type: "object", properties: { name: { type: "string" } } },
      onSuccess: (output) => {
        capturedOutput = output
      },
    })

    expect(tool.execute).toBeDefined()
    const testArgs = { name: "Test Company" }
    const result = await tool.execute?.(testArgs, {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: undefined as unknown as AbortSignal,
    })

    expect(capturedOutput).toEqual(testArgs)
    expect(result.output).toBe("Structured output captured successfully.")
    expect(result.metadata.valid).toBe(true)
  })

  test("AI SDK validates schema before execute - missing required field", async () => {
    // Note: The AI SDK validates the input against the schema BEFORE calling execute()
    // So invalid inputs never reach the tool's execute function
    // This test documents the expected schema behavior
    const tool = SessionPrompt.createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "age"],
      },
      onSuccess: () => {},
    })

    // The schema requires both 'name' and 'age'
    expect(tool.inputSchema).toBeDefined()
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK FlexibleSchema needs any cast for test assertions
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.required).toContain("name")
    expect(inputSchema.jsonSchema?.required).toContain("age")
  })

  test("AI SDK validates schema types before execute - wrong type", async () => {
    // Note: The AI SDK validates the input against the schema BEFORE calling execute()
    // So invalid inputs never reach the tool's execute function
    // This test documents the expected schema behavior
    const tool = SessionPrompt.createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          count: { type: "number" },
        },
        required: ["count"],
      },
      onSuccess: () => {},
    })

    // The schema defines 'count' as a number
    expect(tool.inputSchema).toBeDefined()
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK FlexibleSchema needs any cast for test assertions
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.properties?.count?.type).toBe("number")
  })

  test("execute handles nested objects", async () => {
    let capturedOutput: unknown

    const tool = SessionPrompt.createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
            },
            required: ["name"],
          },
        },
        required: ["user"],
      },
      onSuccess: (output) => {
        capturedOutput = output
      },
    })

    // Valid nested object - AI SDK validates before calling execute()
    const validResult = await tool.execute?.(
      { user: { name: "John", email: "john@test.com" } },
      {
        toolCallId: "test-call-id",
        messages: [],
        abortSignal: undefined as unknown as AbortSignal,
      },
    )

    expect(capturedOutput).toEqual({ user: { name: "John", email: "john@test.com" } })
    expect(validResult.metadata.valid).toBe(true)

    // Verify schema has correct nested structure
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK FlexibleSchema needs any cast for test assertions
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.properties?.user?.type).toBe("object")
    expect(inputSchema.jsonSchema?.properties?.user?.properties?.name?.type).toBe("string")
    expect(inputSchema.jsonSchema?.properties?.user?.required).toContain("name")
  })

  test("execute handles arrays", async () => {
    let capturedOutput: unknown

    const tool = SessionPrompt.createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["tags"],
      },
      onSuccess: (output) => {
        capturedOutput = output
      },
    })

    // Valid array - AI SDK validates before calling execute()
    const validResult = await tool.execute?.(
      { tags: ["a", "b", "c"] },
      {
        toolCallId: "test-call-id",
        messages: [],
        abortSignal: undefined as unknown as AbortSignal,
      },
    )

    expect(capturedOutput).toEqual({ tags: ["a", "b", "c"] })
    expect(validResult.metadata.valid).toBe(true)

    // Verify schema has correct array structure
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK FlexibleSchema needs any cast for test assertions
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.properties?.tags?.type).toBe("array")
    expect(inputSchema.jsonSchema?.properties?.tags?.items?.type).toBe("string")
  })

  test("toModelOutput returns text value", () => {
    const tool = SessionPrompt.createStructuredOutputTool({
      schema: { type: "object" },
      onSuccess: () => {},
    })

    if (!tool.toModelOutput) throw new Error("expected toModelOutput")
    const modelOutput = tool.toModelOutput({
      output: "Test output",
      title: "Test",
      metadata: { valid: true },
    })

    expect(modelOutput.type).toBe("text")
    expect(modelOutput.value).toBe("Test output")
  })

  // Note: Retry behavior is handled by the AI SDK and the prompt loop, not the tool itself
  // The tool simply calls onSuccess when execute() is called with valid args
  // See prompt.ts loop() for actual retry logic
})
