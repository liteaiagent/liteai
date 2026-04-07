import { afterAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { LLM } from "../../src/session/llm"
import { Message } from "../../src/session/message"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, SessionID } from "../../src/session/schema"
import { MessageTable, SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

describe("SessionProcessor Abort Reasoning Flush", () => {
  const originalStream = LLM.stream

  afterAll(() => {
    LLM.stream = originalStream
  })

  test("flushes in-flight reasoning parts perfectly when aborted mid-stream", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".liteai", "settings.json"),
          JSON.stringify({
            $schema: "https://liteai.com/config.json",
            enabled_providers: ["openai"],
            provider: {
              openai: {
                name: "OpenAI",
                env: ["OPENAI_API_KEY"],
                npm: "@ai-sdk/openai",
                api: "https://api.openai.com/v1",
                options: { apiKey: "test-openai-key" },
                models: { "gpt-4": { id: "gpt-4" } },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_test-session")
        const assistantMessageID = MessageID.make("msg_test-assistant")
        const userMessageID = MessageID.make("msg_test-user")
        const abortController = new AbortController()

        const assistantMessage: Message.Assistant = {
          id: assistantMessageID,
          sessionID: sessionID,
          role: "assistant",
          time: { created: Date.now() },
          parentID: userMessageID,
          modelID: "gpt-4" as ModelID,
          providerID: "openai" as ProviderID,
          mode: "primary",
          agent: "test",
          path: { cwd: "/", root: "/" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }

        // Setup db
        await Database.use((db) => {
          db.insert(ProjectTable)
            .values({ id: "prj_test" as never, worktree: "", sandboxes: [], time_created: Date.now() })
            .run()
          db.insert(SessionTable)
            .values({
              id: sessionID,
              project_id: "prj_test" as never,
              slug: "test-slug",
              directory: "/",
              title: "Test",
              version: "1.0",
              time_created: Date.now(),
            })
            .run()
          db.insert(MessageTable)
            .values({
              id: assistantMessageID,
              session_id: sessionID,
              time_created: Date.now(),
              data: assistantMessage,
            })
            .run()
        })

        // Mock LLM.stream
        LLM.stream = async ({ abort }) => {
          let aborted = false
          abort?.addEventListener("abort", () => {
            aborted = true
          })

          const iter = async function* () {
            // Emulate receiving the start
            yield { type: "reasoning-start", id: "reasoning-0" } as never

            // Wait slightly to let SQLite update write
            await new Promise((r) => setTimeout(r, 50))

            // Emulate chunks
            yield { type: "reasoning-delta", id: "reasoning-0", text: "I am " } as never
            yield { type: "reasoning-delta", id: "reasoning-0", text: "thinking" } as never

            // Stay yielded forever until aborted, then throw AbortError
            while (!aborted) {
              await new Promise((r) => setTimeout(r, 10))
            }

            const e = new DOMException("The user aborted a request.", "AbortError")
            throw e
          }

          return {
            fullStream: iter(),
          } as never
        }

        const resolved = await Provider.getModel(ProviderID.openai, ModelID.make("gpt-4"))

        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID,
          model: resolved,
          abort: abortController.signal,
        })

        // Let it run in background
        const processPromise = processor.process({
          user: {
            role: "user",
            id: userMessageID,
            sessionID,
            time: { created: Date.now() },
            agent: "test",
            model: { providerID: ProviderID.openai, modelID: ModelID.make("gpt-4") },
          },
          agent: {
            name: "test",
            mode: "primary",
            options: {},
            permission: [{ permission: "*", action: "allow", pattern: "*" }],
          },
          model: resolved,
          abort: abortController.signal,
          sessionID,
          system: [],
          messages: [],
          tools: {},
        })

        // Trigger abort mid-stream
        setTimeout(() => {
          abortController.abort()
        }, 300)

        const result = await processPromise

        // Verify result is stop
        expect(result).toBe("stop")

        // Load the parts from the database to see what got saved
        const parts = await Message.parts(assistantMessageID)

        // Should have reasoning + step-finish
        expect(parts.length).toBe(2)

        // Reasoning part persisted correctly
        const reasoningPart = parts.find((p) => p.type === "reasoning") as Message.ReasoningPart
        expect(reasoningPart).toBeDefined()
        expect(reasoningPart.text).toBe("I am thinking")
        expect(reasoningPart.time.end).toBeDefined()
        expect(reasoningPart.time.start).toBeDefined()

        // Step-finish part written on abort
        const stepFinish = parts.find((p) => p.type === "step-finish") as Message.StepFinishPart
        expect(stepFinish).toBeDefined()
        expect(stepFinish.reason).toBe("error")
        expect(stepFinish.tokens).toEqual({
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        })
      },
    })
  })
})
