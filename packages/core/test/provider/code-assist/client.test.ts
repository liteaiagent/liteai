import { describe, expect, test } from "bun:test"
import type { AuthClient } from "google-auth-library"
import {
  CA_ENDPOINT,
  CA_VERSION,
  generate,
  getOperation,
  loadCodeAssist,
  onboardUser,
  stream,
} from "../../../src/provider/sdk/code-assist/client"
import type { CAGenerateContentRequest, CAGenerateContentResponse } from "../../../src/provider/sdk/code-assist/types"

/** Creates a mock AuthClient whose `.request()` calls `handler` with the gaxios options. */
function mockClient(handler: (opts: Record<string, unknown>) => unknown): AuthClient {
  return {
    request: async (opts: Record<string, unknown>) => {
      const result = await handler(opts)
      return { data: result }
    },
  } as unknown as AuthClient
}

/** Creates a mock AuthClient that returns the given body for every request. */
function mockOk(body: unknown): AuthClient {
  return mockClient(() => body)
}

/** Creates a mock AuthClient that throws a gaxios-style error. */
function mockErr(status: number, text = ""): AuthClient {
  return {
    request: async () => {
      const error = new Error(`Request failed with status code ${status}`)
      Object.assign(error, {
        response: { status, data: text },
        code: `${status}`,
      })
      throw error
    },
  } as unknown as AuthClient
}

/** Creates a mock streaming AuthClient from SSE text content. */
function mockStream(sseContent: string): AuthClient {
  return {
    request: async () => {
      // Simulate a Node.js-style readable stream via async generator
      async function* gen() {
        const encoder = new TextEncoder()
        yield encoder.encode(sseContent)
      }
      return { data: gen() }
    },
  } as unknown as AuthClient
}

const req: CAGenerateContentRequest = {
  model: "m",
  request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
}

// ── generate ────────────────────────────────────────────────────────

describe("generate", () => {
  test("sends POST to generateContent", async () => {
    let capturedUrl = ""
    let capturedMethod = ""
    const client = mockClient((opts) => {
      capturedUrl = opts.url as string
      capturedMethod = opts.method as string
      return { response: { candidates: [] } }
    })
    await generate({ client }, req)
    expect(capturedUrl).toBe(`${CA_ENDPOINT}/${CA_VERSION}:generateContent`)
    expect(capturedMethod).toBe("POST")
  })

  test("returns parsed response", async () => {
    const body: CAGenerateContentResponse = {
      response: { candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }] },
    }
    const cfg = { client: mockOk(body) }
    const res = await generate(cfg, req)
    expect(res.response?.candidates?.[0].content?.parts?.[0].text).toBe("hi")
  })

  test("throws on error status", async () => {
    const cfg = { client: mockErr(500, "internal error") }
    expect(generate(cfg, req)).rejects.toThrow("500")
  })

  test("custom endpoint", async () => {
    let capturedUrl = ""
    const client = mockClient((opts) => {
      capturedUrl = opts.url as string
      return {}
    })
    await generate({ client, endpoint: "https://custom.api.com" }, req)
    expect(capturedUrl).toStartWith("https://custom.api.com/")
  })

  test("custom headers injected", async () => {
    let capturedHeaders: Record<string, string> = {}
    const client = mockClient((opts) => {
      capturedHeaders = opts.headers as Record<string, string>
      return {}
    })
    await generate({ client, httpOptions: { headers: { Authorization: "Bearer tok" } } }, req)
    expect(capturedHeaders.Authorization).toBe("Bearer tok")
  })
})

// ── stream ──────────────────────────────────────────────────────────

describe("stream", () => {
  test("parses SSE chunks", async () => {
    const chunks: CAGenerateContentResponse[] = [
      { response: { candidates: [{ content: { parts: [{ text: "a" }] } }] } },
      { response: { candidates: [{ content: { parts: [{ text: "b" }] } }] } },
    ]
    const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")
    const cfg = { client: mockStream(sse) }
    const results: CAGenerateContentResponse[] = []
    for await (const chunk of stream(cfg, req)) {
      results.push(chunk)
    }
    expect(results).toHaveLength(2)
    expect(results[0].response?.candidates?.[0].content?.parts?.[0].text).toBe("a")
    expect(results[1].response?.candidates?.[0].content?.parts?.[0].text).toBe("b")
  })

  test("throws on error status", async () => {
    const cfg = { client: mockErr(400, "bad request") }
    expect(async () => {
      for await (const _ of stream(cfg, req)) {
        /* drain */
      }
    }).toThrow("400")
  })

  test("skips unparseable data lines", async () => {
    const sse = `data: ${JSON.stringify({ a: 1 })}\n\ndata: [DONE]\n\n`
    const cfg = { client: mockStream(sse) }
    const results: unknown[] = []
    for await (const chunk of stream(cfg, req)) {
      results.push(chunk)
    }
    expect(results).toHaveLength(1)
  })

  test("sends to streamGenerateContent endpoint", async () => {
    let capturedUrl = ""
    const client: AuthClient = {
      request: async (opts: Record<string, unknown>) => {
        capturedUrl = opts.url as string
        async function* gen() {
          /* empty */
        }
        return { data: gen() }
      },
    } as unknown as AuthClient

    for await (const _ of stream({ client }, req)) {
      /* noop */
    }
    expect(capturedUrl).toContain("streamGenerateContent")
  })
})

// ── loadCodeAssist ──────────────────────────────────────────────────

describe("loadCodeAssist", () => {
  test("returns response on success", async () => {
    const body = { currentTier: { id: "free-tier" }, cloudaicompanionProject: "proj" }
    const cfg = { client: mockOk(body) }
    const res = await loadCodeAssist(cfg, { metadata: {} })
    expect(res.currentTier?.id).toBe("free-tier")
    expect(res.cloudaicompanionProject).toBe("proj")
  })

  test("throws on failure", async () => {
    const cfg = { client: mockErr(403, "forbidden") }
    expect(loadCodeAssist(cfg, { metadata: {} })).rejects.toThrow("403")
  })
})

// ── onboardUser ─────────────────────────────────────────────────────

describe("onboardUser", () => {
  test("returns LRO response", async () => {
    const body = { name: "operations/123", done: false }
    const cfg = { client: mockOk(body) }
    const res = await onboardUser(cfg, { tierId: "free-tier", cloudaicompanionProject: undefined, metadata: undefined })
    expect(res.name).toBe("operations/123")
    expect(res.done).toBe(false)
  })

  test("throws on failure", async () => {
    const cfg = { client: mockErr(500) }
    expect(onboardUser(cfg, { tierId: "t", cloudaicompanionProject: undefined, metadata: undefined })).rejects.toThrow(
      "500",
    )
  })
})

// ── getOperation ─────────────────────────────────────────────────────

describe("getOperation", () => {
  test("sends GET to operation URL", async () => {
    let capturedMethod = ""
    let capturedUrl = ""
    const client = mockClient((opts) => {
      capturedUrl = opts.url as string
      capturedMethod = opts.method as string
      return { done: true }
    })
    await getOperation({ client }, "operations/123")
    expect(capturedMethod).toBe("GET")
    expect(capturedUrl).toBe(`${CA_ENDPOINT}/${CA_VERSION}/operations/123`)
  })

  test("throws on failure", async () => {
    const cfg = { client: mockErr(404) }
    expect(getOperation(cfg, "operations/xxx")).rejects.toThrow("404")
  })
})
