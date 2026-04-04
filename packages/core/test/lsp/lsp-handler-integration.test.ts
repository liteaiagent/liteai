import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import path from "node:path"
import { decodeFrames, encode } from "../fixture/lsp/jsonrpc-helpers"

const HANDLER_SCRIPT = path.join(__dirname, "../fixture/lsp/start-lsp-handler.ts")

/**
 * Spawn the LSP handler subprocess and return helpers to communicate.
 */
function spawnHandler() {
  const proc = spawn("bun", ["run", HANDLER_SCRIPT], {
    stdio: "pipe",
    env: {
      ...process.env,
      // Prevent models.dev fetch and DB initialization during tests
      LITEAI_DISABLE_MODELS_FETCH: "true",
      LITEAI_DB_MEMORY: "true",
    },
  })
  let readBuffer: Buffer = Buffer.alloc(0)
  const received: unknown[] = []

  proc.stdout?.on("data", (chunk: Buffer) => {
    readBuffer = Buffer.concat([readBuffer, chunk])
    const { messages, rest } = decodeFrames(readBuffer)
    readBuffer = rest
    for (const m of messages) {
      try {
        received.push(JSON.parse(m))
      } catch {}
    }
  })

  let nextId = 1

  return {
    proc,
    received,
    sendRequest(method: string, params: unknown = {}) {
      const id = nextId++
      proc.stdin?.write(encode({ jsonrpc: "2.0", id, method, params }))
      return id
    },
    sendNotification(method: string, params: unknown = {}) {
      proc.stdin?.write(encode({ jsonrpc: "2.0", method, params }))
    },
    async waitForResponse(id: number, timeoutMs = 15000): Promise<unknown> {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const match = received.find((r) => (r as { id?: number | string })?.id === id)
        if (match) return match
        await new Promise((r) => setTimeout(r, 50))
      }
      throw new Error(`Timeout waiting for response to id=${id}`)
    },
    kill() {
      proc.kill("SIGKILL")
    },
  }
}

describe("LSP handler integration", () => {
  let handler: ReturnType<typeof spawnHandler> | undefined

  afterEach(() => {
    handler?.kill()
    handler = undefined
  })

  test("responds to initialize with inlineCompletionProvider capability", async () => {
    handler = spawnHandler()

    const id = handler.sendRequest("initialize", {
      processId: process.pid,
      rootUri: "file:///tmp/test",
      capabilities: {},
    })

    const response = (await handler.waitForResponse(id)) as {
      result: {
        capabilities: {
          inlineCompletionProvider: unknown
          textDocumentSync: unknown
        }
      }
    }

    expect(response.result).toBeDefined()
    expect(response.result.capabilities).toBeDefined()
    expect(response.result.capabilities.inlineCompletionProvider).toBeDefined()
    expect(response.result.capabilities.textDocumentSync).toBeDefined()
  }, 20000)

  test("responds to initialize + initialized lifecycle", async () => {
    handler = spawnHandler()

    const id = handler.sendRequest("initialize", {
      processId: process.pid,
      rootUri: "file:///tmp/test",
      capabilities: {},
    })

    const response = (await handler.waitForResponse(id)) as {
      result: { capabilities: unknown }
    }
    expect(response.result.capabilities).toBeDefined()

    // Send initialized notification (should not crash)
    handler.sendNotification("initialized", {})

    // Give it a moment to process
    await new Promise((r) => setTimeout(r, 200))

    // The server should still be alive — send another request
    const shutdownId = handler.sendRequest("shutdown")
    const shutdownResponse = (await handler.waitForResponse(shutdownId)) as {
      result: unknown
    }
    expect(shutdownResponse.result).toBeNull()
  }, 20000)
})
