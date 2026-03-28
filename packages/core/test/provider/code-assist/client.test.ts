import { describe, expect, test } from "bun:test"
import type { FetchFunction } from "@ai-sdk/provider-utils"
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

function ok(body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function err(status: number, text = ""): Response {
  return new Response(text, { status })
}

const req: CAGenerateContentRequest = {
  model: "m",
  request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
}

// ── generate ────────────────────────────────────────────────────────

describe("generate", () => {
  test("sends POST to generateContent", async () => {
    let url = ""
    let method = ""
    const cfg = {
      fetch: (async (input: string, init: RequestInit) => {
        url = input
        method = init.method ?? ""
        return ok({ response: { candidates: [] } })
      }) as unknown as FetchFunction,
    }
    await generate(cfg, req)
    expect(url).toBe(`${CA_ENDPOINT}/${CA_VERSION}:generateContent`)
    expect(method).toBe("POST")
  })

  test("returns parsed response", async () => {
    const body: CAGenerateContentResponse = {
      response: { candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }] },
    }
    const cfg = { fetch: (async () => ok(body)) as unknown as FetchFunction }
    const res = await generate(cfg, req)
    expect(res.response?.candidates?.[0].content?.parts?.[0].text).toBe("hi")
  })

  test("throws on non-ok status", async () => {
    const cfg = { fetch: (async () => err(500, "internal error")) as unknown as FetchFunction }
    expect(generate(cfg, req)).rejects.toThrow("500")
  })

  test("custom endpoint", async () => {
    let url = ""
    const cfg = {
      endpoint: "https://custom.api.com",
      fetch: (async (input: string) => {
        url = input
        return ok({})
      }) as unknown as FetchFunction,
    }
    await generate(cfg, req)
    expect(url).toStartWith("https://custom.api.com/")
  })

  test("custom headers injected", async () => {
    let captured: Record<string, string> = {}
    const cfg = {
      headers: () => ({ Authorization: "Bearer tok" }),
      fetch: (async (_url: string, init: RequestInit) => {
        captured = init.headers as Record<string, string>
        return ok({})
      }) as unknown as FetchFunction,
    }
    await generate(cfg, req)
    expect(captured.Authorization).toBe("Bearer tok")
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
    const cfg = {
      fetch: (async () =>
        new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })) as unknown as FetchFunction,
    }
    const results: CAGenerateContentResponse[] = []
    for await (const chunk of stream(cfg, req)) {
      results.push(chunk)
    }
    expect(results).toHaveLength(2)
    expect(results[0].response?.candidates?.[0].content?.parts?.[0].text).toBe("a")
    expect(results[1].response?.candidates?.[0].content?.parts?.[0].text).toBe("b")
  })

  test("throws on non-ok status", async () => {
    const cfg = { fetch: (async () => err(400, "bad request")) as unknown as FetchFunction }
    expect(async () => {
      for await (const _ of stream(cfg, req)) {
        /* drain */
      }
    }).toThrow("400")
  })

  test("throws on missing body", async () => {
    const cfg = {
      fetch: (async () => new Response(null, { status: 200 })) as unknown as FetchFunction,
    }
    expect(async () => {
      for await (const _ of stream(cfg, req)) {
        /* drain */
      }
    }).toThrow("no body")
  })

  test("skips unparseable data lines", async () => {
    const sse = `data: ${JSON.stringify({ a: 1 })}\n\ndata: [DONE]\n\n`
    const cfg = {
      fetch: (async () =>
        new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })) as unknown as FetchFunction,
    }
    const results: unknown[] = []
    for await (const chunk of stream(cfg, req)) {
      results.push(chunk)
    }
    expect(results).toHaveLength(1)
  })

  test("sends to streamGenerateContent endpoint", async () => {
    let url = ""
    const cfg = {
      fetch: (async (input: string) => {
        url = input
        return new Response("", { status: 200, headers: { "Content-Type": "text/event-stream" } })
      }) as unknown as FetchFunction,
    }
    // drain
    for await (const _ of stream(cfg, req)) {
      /* noop */
    }
    expect(url).toContain("streamGenerateContent")
    expect(url).toContain("alt=sse")
  })
})

// ── loadCodeAssist ──────────────────────────────────────────────────

describe("loadCodeAssist", () => {
  test("returns response on success", async () => {
    const body = { currentTier: { id: "free-tier" }, cloudaicompanionProject: "proj" }
    const cfg = { fetch: (async () => ok(body)) as unknown as FetchFunction }
    const res = await loadCodeAssist(cfg, { metadata: {} })
    expect(res.currentTier?.id).toBe("free-tier")
    expect(res.cloudaicompanionProject).toBe("proj")
  })

  test("throws on failure", async () => {
    const cfg = { fetch: (async () => err(403, "forbidden")) as unknown as FetchFunction }
    expect(loadCodeAssist(cfg, { metadata: {} })).rejects.toThrow("403")
  })
})

// ── onboardUser ─────────────────────────────────────────────────────

describe("onboardUser", () => {
  test("returns LRO response", async () => {
    const body = { name: "operations/123", done: false }
    const cfg = { fetch: (async () => ok(body)) as unknown as FetchFunction }
    const res = await onboardUser(cfg, { tierId: "free-tier", cloudaicompanionProject: undefined, metadata: undefined })
    expect(res.name).toBe("operations/123")
    expect(res.done).toBe(false)
  })

  test("throws on failure", async () => {
    const cfg = { fetch: (async () => err(500)) as unknown as FetchFunction }
    expect(onboardUser(cfg, { tierId: "t", cloudaicompanionProject: undefined, metadata: undefined })).rejects.toThrow(
      "500",
    )
  })
})

// ── getOperation ─────────────────────────────────────────────────────

describe("getOperation", () => {
  test("sends GET to operation URL", async () => {
    let method = ""
    let url = ""
    const cfg = {
      fetch: (async (input: string, init: RequestInit) => {
        url = input
        method = init.method ?? ""
        return ok({ done: true })
      }) as unknown as FetchFunction,
    }
    await getOperation(cfg, "operations/123")
    expect(method).toBe("GET")
    expect(url).toBe(`${CA_ENDPOINT}/${CA_VERSION}/operations/123`)
  })

  test("throws on failure", async () => {
    const cfg = { fetch: (async () => err(404)) as unknown as FetchFunction }
    expect(getOperation(cfg, "operations/xxx")).rejects.toThrow("404")
  })
})
