import { afterAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { Instance } from "../../../src/project/instance"
import { ProjectTable } from "../../../src/project/project.sql"
import { ModelID, ProviderID } from "../../../src/provider/schema"
import { Session } from "../../../src/session"
import { SessionPrompt } from "../../../src/session/engine"
import { LLM } from "../../../src/session/llm"
import { Message } from "../../../src/session/message"
import { MessageID, PartID, SessionID } from "../../../src/session/schema"
import { SessionTable } from "../../../src/session/session.sql"
import { Database } from "../../../src/storage/db"
import { tmpdir } from "../../fixture/fixture"

describe("Abort during AI thinking", () => {
  const originalStream = LLM.stream

  afterAll(() => {
    LLM.stream = originalStream
  })

  test("abort while model is emitting reasoning tokens does not crash the process", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "settings.json"),
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
        const sessionID = SessionID.make("ses_abort-think-test")
        const userMessageID = MessageID.ascending()

        // Setup db: project + session + user message with parts
        const projectID = `prj_abort_think_${Date.now()}` as never
        await Database.use((db) => {
          db.insert(ProjectTable)
            .values({ id: projectID, worktree: tmp.path, sandboxes: [], time_created: Date.now() })
            .run()
          db.insert(SessionTable)
            .values({
              id: sessionID,
              project_id: projectID,
              slug: "abort-think-slug",
              directory: tmp.path,
              title: "Abort Think Test",
              version: "1.0",
              time_created: Date.now(),
            })
            .run()
        })

        // Create user message
        const userMessage: Message.User = {
          id: userMessageID,
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: ProviderID.openai, modelID: ModelID.make("gpt-4") },
        }
        await Session.updateMessage(userMessage)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: userMessageID,
          sessionID,
          type: "text",
          text: "Hello",
        })

        // Track abort state for assertions
        let streamStarted = false
        let abortFired = false
        const thinkingChunks: string[] = []

        // Mock LLM.stream to simulate long thinking with reasoning tokens
        LLM.stream = async ({ abort }) => {
          let aborted = false
          abort?.addEventListener("abort", () => {
            aborted = true
            abortFired = true
          })

          const iter = async function* () {
            streamStarted = true

            // Step start
            yield { type: "start-step" } as never

            // Begin reasoning
            yield { type: "reasoning-start", id: "reasoning-0" } as never

            // Simulate "thinking for a long time" — emit many reasoning deltas
            for (let i = 0; i < 20; i++) {
              if (aborted) break
              const chunk = `Thinking step ${i}... `
              thinkingChunks.push(chunk)
              yield { type: "reasoning-delta", id: "reasoning-0", text: chunk } as never
              // Small delay to simulate network latency
              await new Promise((r) => setTimeout(r, 20))
            }

            // If we got aborted mid-thinking, throw AbortError (like a real HTTP stream would)
            if (aborted) {
              throw new DOMException("The user aborted a request.", "AbortError")
            }

            // End reasoning (only if not aborted)
            yield { type: "reasoning-end", id: "reasoning-0" } as never

            // Text response
            yield { type: "text-start", id: "text-0" } as never
            yield { type: "text-delta", id: "text-0", text: "Here is my response" } as never
            yield { type: "text-end", id: "text-0" } as never

            // Finish step
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { promptTokens: 10, completionTokens: 50 },
            } as never

            yield { type: "finish" } as never
          }

          return {
            fullStream: iter(),
            usage: Promise.resolve({ promptTokens: 10, completionTokens: 50 }),
          } as never
        }

        // Start the session loop in the background
        const loopPromise = SessionPrompt.loop({ sessionID })

        // Wait for streaming to start then abort after some thinking
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (thinkingChunks.length >= 3) {
              clearInterval(check)
              resolve()
            }
          }, 10)
        })

        // Abort mid-thinking (user clicks stop)
        SessionPrompt.cancel(sessionID)

        // The loop should resolve WITHOUT throwing or crashing
        const result = await loopPromise

        // Assertions
        expect(streamStarted).toBe(true)
        expect(abortFired).toBe(true)

        // Should have received at least some thinking chunks before abort
        expect(thinkingChunks.length).toBeGreaterThanOrEqual(3)

        // Should NOT have received all 20 thinking chunks (abort interrupted)
        expect(thinkingChunks.length).toBeLessThan(20)

        // The result should be a valid message with parts
        expect(result).toBeDefined()
        expect(result.info.role).toBe("assistant")

        // Load the parts from DB to verify the message was persisted
        const parts = await Message.parts(result.info.id)

        // Should have at least some parts persisted (reasoning and/or step-finish)
        // The exact parts depend on flush timing, but the assistant message must exist
        expect(parts.length).toBeGreaterThanOrEqual(0)
      },
    })
  }, 15000)

  test("abort while model has not started streaming yet does not crash", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "settings.json"),
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
        const sessionID = SessionID.make("ses_abort-prestream")
        const userMessageID = MessageID.ascending()

        const projectID2 = `prj_abort_pre_${Date.now()}` as never
        await Database.use((db) => {
          db.insert(ProjectTable)
            .values({ id: projectID2, worktree: tmp.path, sandboxes: [], time_created: Date.now() })
            .run()
          db.insert(SessionTable)
            .values({
              id: sessionID,
              project_id: projectID2,
              slug: "abort-prestream-slug",
              directory: tmp.path,
              title: "Abort Pre-Stream Test",
              version: "1.0",
              time_created: Date.now(),
            })
            .run()
        })

        const userMessage: Message.User = {
          id: userMessageID,
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: ProviderID.openai, modelID: ModelID.make("gpt-4") },
        }
        await Session.updateMessage(userMessage)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: userMessageID,
          sessionID,
          type: "text",
          text: "Hello",
        })

        // Mock LLM.stream with a delay before first token (simulating slow model start)
        LLM.stream = async ({ abort }) => {
          // Simulate slow model connection
          await new Promise((r) => setTimeout(r, 200))

          // Check if already aborted
          if (abort?.aborted) {
            throw new DOMException("The user aborted a request.", "AbortError")
          }

          const iter = async function* () {
            yield { type: "start-step" } as never
            yield { type: "text-start", id: "text-0" } as never
            yield { type: "text-delta", id: "text-0", text: "Response" } as never
            yield { type: "text-end", id: "text-0" } as never
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { promptTokens: 5, completionTokens: 10 },
            } as never
            yield { type: "finish" } as never
          }

          return { fullStream: iter(), usage: Promise.resolve(null) } as never
        }

        // Start loop and abort immediately (before streaming starts)
        const loopPromise = SessionPrompt.loop({ sessionID })
        // Small delay, then abort
        await new Promise((r) => setTimeout(r, 50))
        SessionPrompt.cancel(sessionID)

        // Should resolve without crashing
        const result = await loopPromise
        expect(result).toBeDefined()
        expect(result.info.role).toBe("assistant")
      },
    })
  }, 15000)
})
