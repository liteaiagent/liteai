import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import path from "node:path"
import type { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { LLM } from "../../src/session/llm"
import type { Message } from "../../src/session/message"
import { MessageID, SessionID } from "../../src/session/schema"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

// ── Test infrastructure ─────────────────────────────────────────────────────
// Reuses the same mock-server pattern from llm.test.ts

type Capture = {
  url: URL
  headers: Headers
  body: Record<string, unknown>
}

const state = {
  server: null as ReturnType<typeof Bun.serve> | null,
  queue: [] as Array<{ path: string; response: Response; resolve: (value: Capture) => void }>,
}

function deferred<T>() {
  const result = {} as { promise: Promise<T>; resolve: (value: T) => void }
  result.promise = new Promise((resolve) => {
    result.resolve = resolve
  })
  return result
}

function waitRequest(pathname: string, response: Response) {
  const pending = deferred<Capture>()
  state.queue.push({ path: pathname, response, resolve: pending.resolve })
  return pending.promise
}

function createChatStream(text: string) {
  const payload = `${[
    `data: ${JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      choices: [{ delta: { role: "assistant" } }],
    })}`,
    `data: ${JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      choices: [{ delta: { content: text } }],
    })}`,
    `data: ${JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      choices: [{ delta: {}, finish_reason: "stop" }],
    })}`,
    "data: [DONE]",
  ].join("\n\n")}\n\n`

  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.close()
    },
  })
}

async function loadFixture(providerID: string, modelID: string) {
  const fixturePath = path.join(import.meta.dir, "../tool/fixtures/models-api.json")
  const data = await Filesystem.readJson<Record<string, { models: Record<string, unknown> }>>(fixturePath)
  const provider = data[providerID]
  if (!provider) throw new Error(`Missing provider in fixture: ${providerID}`)
  const model = provider.models[modelID]
  if (!model) throw new Error(`Missing model in fixture: ${modelID}`)
  return { provider, model }
}

beforeAll(() => {
  state.server = Bun.serve({
    port: 0,
    async fetch(req) {
      const next = state.queue.shift()
      if (!next) return new Response("unexpected request", { status: 500 })

      const url = new URL(req.url)
      const body = (await req.json()) as Record<string, unknown>
      next.resolve({ url, headers: req.headers, body })

      if (!url.pathname.endsWith(next.path)) return new Response("not found", { status: 404 })
      return next.response
    },
  })
})

beforeEach(() => {
  state.queue.length = 0
})

afterAll(() => {
  state.server?.stop()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe("session.llm telemetry metadata", () => {
  test("langgraph_node and langgraph_step use bare keys (no prefix)", async () => {
    // This test verifies that the telemetry metadata keys for Langfuse graph
    // visualization are bare ('langgraph_node', 'langgraph_step') and NOT
    // prefixed with 'langfuse.observation.metadata.'. This matters because:
    //
    // 1. The AI SDK wraps metadata as 'ai.telemetry.metadata.<key>'
    // 2. Langfuse strips 'ai.telemetry.metadata.' prefix → final key is '<key>'
    // 3. Langfuse Clickhouse query reads metadata['langgraph_node']
    //
    // If the key is 'langfuse.observation.metadata.langgraph_node', the final
    // stored key becomes 'langfuse.observation.metadata.langgraph_node' which
    // does NOT match the Clickhouse query's metadata['langgraph_node'] lookup.
    const server = state.server
    if (!server) throw new Error("Server not initialized")

    const providerID = "alibaba"
    const modelID = "qwen-plus"
    await loadFixture(providerID, modelID)

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hi"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        const liteaiDir = path.join(dir, ".liteai")
        await Bun.write(
          path.join(liteaiDir, "settings.json"),
          JSON.stringify({
            $schema: "https://liteai.com/config.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: {
                  apiKey: "test-key",
                  baseURL: `${server.url.origin}/v1`,
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(modelID))
        const sessionID = SessionID.make("session-telemetry-1")
        const agent = {
          name: "liteai",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-tel-1"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
        } satisfies Message.User

        // Capture the streamText call to inspect telemetry metadata
        // We can't directly inspect the telemetry config, but we can
        // verify the metadata structure by importing the source and
        // checking the metadata keys don't use the wrong prefix.
        //
        // Direct structural test: read the source and verify no
        // 'langfuse.observation.metadata.langgraph_' keys exist.
        const source = await Bun.file(path.join(import.meta.dir, "../../src/session/llm.ts")).text()

        // Verify bare keys are used (correct)
        expect(source).toContain("langgraph_node: input.agent.name")
        expect(source).toContain("langgraph_step: String(input.telemetryTracker?.getStep(input.telemetryBatchId) ?? 1)")

        // Verify prefixed keys are NOT used (would break Clickhouse lookup)
        expect(source).not.toContain('"langfuse.observation.metadata.langgraph_node"')
        expect(source).not.toContain('"langfuse.observation.metadata.langgraph_step"')

        const stream = await LLM.stream({
          user,
          sessionID,
          model: resolved,
          agent,
          system: ["You are a helpful assistant."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })

        for await (const _ of stream.fullStream) {
        }

        await request
      },
    })
  })

  test("step parameter defaults to 1 when not provided", async () => {
    const server = state.server
    if (!server) throw new Error("Server not initialized")

    const providerID = "alibaba"
    const modelID = "qwen-plus"
    await loadFixture(providerID, modelID)

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hi"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        const liteaiDir = path.join(dir, ".liteai")
        await Bun.write(
          path.join(liteaiDir, "settings.json"),
          JSON.stringify({
            $schema: "https://liteai.com/config.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: {
                  apiKey: "test-key",
                  baseURL: `${server.url.origin}/v1`,
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(modelID))
        const sessionID = SessionID.make("session-telemetry-2")
        const agent = {
          name: "code",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-tel-2"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
        } satisfies Message.User

        // Call without step parameter — should default to 1
        const stream = await LLM.stream({
          user,
          sessionID,
          model: resolved,
          agent,
          system: ["You are a helpful assistant."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })

        for await (const _ of stream.fullStream) {
        }

        await request

        // Verify the default works via source inspection
        // The expression `String(input.telemetryTracker?.getStep(input.telemetryBatchId) ?? 1)` ensures step defaults to "1"
        const source = await Bun.file(path.join(import.meta.dir, "../../src/session/llm.ts")).text()
        expect(source).toContain("String(input.telemetryTracker?.getStep(input.telemetryBatchId) ?? 1)")
      },
    })
  })
})
