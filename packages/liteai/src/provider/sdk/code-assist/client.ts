// HTTP client for the Code Assist API (cloudcode-pa.googleapis.com).
// Ported from gemini-cli/packages/core/src/code_assist/server.ts.

import os from "node:os"
import type { FetchFunction } from "@ai-sdk/provider-utils"
import type {
  CAGenerateContentRequest,
  CAGenerateContentResponse,
  LoadCodeAssistRequest,
  LoadCodeAssistResponse,
  LongRunningOperationResponse,
  OnboardUserRequest,
} from "./types"

export const CA_ENDPOINT = "https://cloudcode-pa.googleapis.com"
export const CA_VERSION = "v1internal"

const UA = `GeminiCLI/1.0.0/liteai (${os.platform()}; ${os.arch()})`

export interface ClientConfig {
  endpoint?: string
  version?: string
  fetch?: FetchFunction
  headers?: () => Record<string, string | undefined>
}

function base(cfg: ClientConfig): string {
  const ep = cfg.endpoint ?? CA_ENDPOINT
  const ver = cfg.version ?? CA_VERSION
  return `${ep}/${ver}`
}

function url(cfg: ClientConfig, method: string): string {
  return `${base(cfg)}:${method}`
}

function operationUrl(cfg: ClientConfig, name: string): string {
  return `${base(cfg)}/${name}`
}

export async function generate(
  cfg: ClientConfig,
  req: CAGenerateContentRequest,
  signal?: AbortSignal,
): Promise<CAGenerateContentResponse> {
  const fn = cfg.fetch ?? fetch
  const res = await fn(url(cfg, "generateContent"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...cfg.headers?.(),
    },
    body: JSON.stringify(req),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Code Assist generateContent failed: ${res.status} ${text}`)
  }
  return res.json()
}

export async function* stream(
  cfg: ClientConfig,
  req: CAGenerateContentRequest,
  signal?: AbortSignal,
): AsyncGenerator<CAGenerateContentResponse> {
  const fn = cfg.fetch ?? fetch
  const res = await fn(`${url(cfg, "streamGenerateContent")}?alt=sse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...cfg.headers?.(),
    },
    body: JSON.stringify(req),
    signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Code Assist streamGenerateContent failed: ${res.status} ${text}`)
  }

  if (!res.body) {
    throw new Error("Code Assist streamGenerateContent returned no body")
  }

  // Parse SSE stream line-by-line (matching liteai-api's proven approach)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let data: string[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += decoder.decode(value, { stream: true })

    // Process complete lines
    for (let idx = buf.indexOf("\n"); idx !== -1; idx = buf.indexOf("\n")) {
      const raw = buf.slice(0, idx).replace(/\r$/, "")
      buf = buf.slice(idx + 1)

      if (raw.startsWith("data: ")) {
        data.push(raw.slice(6))
      } else if (raw === "") {
        // Empty line = event boundary
        if (data.length > 0) {
          const json = data.join("\n")
          data = []
          try {
            yield JSON.parse(json)
          } catch {
            // Skip unparseable chunks (e.g. [DONE])
          }
        }
      }
    }
  }

  // Flush remaining buffered data
  if (data.length > 0) {
    const json = data.join("\n")
    try {
      yield JSON.parse(json)
    } catch {
      // Skip unparseable
    }
  }
}

export async function loadCodeAssist(cfg: ClientConfig, req: LoadCodeAssistRequest): Promise<LoadCodeAssistResponse> {
  const fn = cfg.fetch ?? fetch
  const res = await fn(url(cfg, "loadCodeAssist"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...cfg.headers?.(),
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Code Assist loadCodeAssist failed: ${res.status} ${text}`)
  }
  return res.json()
}

export async function onboardUser(cfg: ClientConfig, req: OnboardUserRequest): Promise<LongRunningOperationResponse> {
  const fn = cfg.fetch ?? fetch
  const res = await fn(url(cfg, "onboardUser"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...cfg.headers?.(),
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Code Assist onboardUser failed: ${res.status} ${text}`)
  }
  return res.json()
}

export async function getOperation(cfg: ClientConfig, name: string): Promise<LongRunningOperationResponse> {
  const fn = cfg.fetch ?? fetch
  const res = await fn(operationUrl(cfg, name), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...cfg.headers?.(),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Code Assist getOperation failed: ${res.status} ${text}`)
  }
  return res.json()
}

/** Side-call for web search grounding via the CA API. */
export async function search(
  cfg: ClientConfig,
  input: { query: string; model: string; project?: string },
  signal?: AbortSignal,
): Promise<{ text: string; sources: Array<{ uri: string; title: string }> }> {
  const req: CAGenerateContentRequest = {
    model: input.model,
    project: input.project,
    user_prompt_id: `search-${Date.now()}`,
    request: {
      contents: [{ role: "user", parts: [{ text: input.query }] }],
      tools: [{ googleSearch: {} }],
    },
  }
  const res = await generate(cfg, req, signal)
  const candidate = res.response?.candidates?.[0]
  const parts = candidate?.content?.parts ?? []
  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("")

  const chunks = candidate?.groundingMetadata?.groundingChunks ?? []
  const sources = chunks.flatMap((c) => {
    const uri = c.web?.uri
    if (!uri) return []
    return [{ uri, title: c.web?.title ?? "Untitled" }]
  })

  // Format with sources list (matching gemini-cli output)
  const lines = sources.map((s, i) => `[${i + 1}] ${s.title} (${s.uri})`)
  const output = lines.length > 0 ? `${text}\n\nSources:\n${lines.join("\n")}` : text

  return { text: output, sources }
}
