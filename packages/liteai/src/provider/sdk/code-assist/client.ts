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
import { UserTierId } from "./types"

export const CA_ENDPOINT = "https://cloudcode-pa.googleapis.com"
export const CA_VERSION = "v1internal"

// Retry config matching gemini-cli/packages/core/src/code_assist/server.ts
const RETRY_COUNT = 3
const RETRY_DEFAULT_DELAY = 100
const RETRY_GENERATE_DELAY = 1000
const RETRYABLE_STATUSES = new Set([429, 499, 500, 502, 503, 504])

export interface ClientConfig {
  endpoint?: string
  version?: string
  fetch?: FetchFunction
  headers?: () => Record<string, string | undefined>
  /** User-Agent string. If not set, a default is used. */
  ua?: string
}

function ua(cfg: ClientConfig): string {
  return cfg.ua ?? `GeminiCLI/1.0.0/liteai (${os.platform()}; ${os.arch()}; terminal)`
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

// Retry helper matching gemini-cli behaviour:
// retries on 429, 499, 500-599 with configurable delay.
async function retryPost<T>(
  cfg: ClientConfig,
  endpoint: string,
  body: string,
  signal: AbortSignal | undefined,
  delay: number,
): Promise<T> {
  const fn = cfg.fetch ?? fetch
  let last: Response | undefined
  for (let i = 0; i <= RETRY_COUNT; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delay))
    last = await fn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": ua(cfg),
        ...cfg.headers?.(),
      },
      body,
      signal,
    })
    if (last.ok) return last.json() as T
    if (!RETRYABLE_STATUSES.has(last.status)) break
  }
  const text = await last!.text().catch(() => "")
  throw new Error(`Code Assist request failed: ${last!.status} ${text}`)
}

export async function generate(
  cfg: ClientConfig,
  req: CAGenerateContentRequest,
  signal?: AbortSignal,
): Promise<CAGenerateContentResponse> {
  return retryPost<CAGenerateContentResponse>(
    cfg,
    url(cfg, "generateContent"),
    JSON.stringify(req),
    signal,
    RETRY_GENERATE_DELAY,
  )
}

export async function* stream(
  cfg: ClientConfig,
  req: CAGenerateContentRequest,
  signal?: AbortSignal,
): AsyncGenerator<CAGenerateContentResponse> {
  // Streaming: no retry (matches gemini-cli's retry: false)
  const fn = cfg.fetch ?? fetch
  const res = await fn(`${url(cfg, "streamGenerateContent")}?alt=sse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": ua(cfg),
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

  // Parse SSE stream line-by-line
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

// VPC-SC detection matching gemini-cli/packages/core/src/code_assist/server.ts
function isVpcSc(e: unknown): boolean {
  if (!e || typeof e !== "object") return false
  const msg = "message" in e ? String((e as Record<string, unknown>).message) : ""
  return msg.includes("SECURITY_POLICY_VIOLATED")
}

export async function loadCodeAssist(cfg: ClientConfig, req: LoadCodeAssistRequest): Promise<LoadCodeAssistResponse> {
  try {
    return await retryPost<LoadCodeAssistResponse>(
      cfg,
      url(cfg, "loadCodeAssist"),
      JSON.stringify(req),
      undefined,
      RETRY_DEFAULT_DELAY,
    )
  } catch (e) {
    // VPC-SC affected users — degrade gracefully (matches gemini-cli)
    if (isVpcSc(e)) {
      return { currentTier: { id: UserTierId.STANDARD } }
    }
    throw e
  }
}

export async function onboardUser(cfg: ClientConfig, req: OnboardUserRequest): Promise<LongRunningOperationResponse> {
  return retryPost<LongRunningOperationResponse>(
    cfg,
    url(cfg, "onboardUser"),
    JSON.stringify(req),
    undefined,
    RETRY_DEFAULT_DELAY,
  )
}

export async function getOperation(cfg: ClientConfig, name: string): Promise<LongRunningOperationResponse> {
  const fn = cfg.fetch ?? fetch
  const res = await fn(operationUrl(cfg, name), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": ua(cfg),
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
