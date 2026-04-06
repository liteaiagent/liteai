// HTTP client for the Code Assist API (cloudcode-pa.googleapis.com).
// Uses google-auth-library's AuthClient (gaxios) to match gemini-cli exactly.

import * as readline from "node:readline"
import { Readable } from "node:stream"
import type { AuthClient } from "google-auth-library"
import { Log } from "@/util/log"
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

const GENERATE_CONTENT_RETRY_DELAY = 1000
const DEFAULT_RETRY_DELAY = 100

export interface HttpOptions {
  headers?: Record<string, string>
}

export interface ClientConfig {
  client: AuthClient
  endpoint?: string
  version?: string
  httpOptions?: HttpOptions
}

function base(cfg: ClientConfig): string {
  const ep = cfg.endpoint ?? process.env.CODE_ASSIST_ENDPOINT ?? CA_ENDPOINT
  const ver = cfg.version ?? process.env.CODE_ASSIST_API_VERSION ?? CA_VERSION
  return `${ep}/${ver}`
}

function methodUrl(cfg: ClientConfig, method: string): string {
  return `${base(cfg)}:${method}`
}

function operationUrl(cfg: ClientConfig, name: string): string {
  return `${base(cfg)}/${name}`
}

// POST with gaxios retry — matches gemini-cli/server.ts requestPost exactly.
async function requestPost<T>(
  cfg: ClientConfig,
  url: string,
  body: object,
  signal: AbortSignal | undefined,
  retryDelay: number,
): Promise<T> {
  const http = Log.create({ service: "http" })
  const method = "POST"

  http.info("request", {
    provider: "google-code-assist",
    method,
    url,
    body: JSON.stringify(body),
  })

  try {
    const res = await cfg.client.request<T>({
      url,
      method,
      headers: {
        ...cfg.httpOptions?.headers,
      },
      responseType: "json",
      data: body, // gaxios uses 'data', not 'body' for objects. Or does it? The original used 'body: JSON.stringify(body)'
      // Wait, original: `body: JSON.stringify(body)`. Let's stick to 'data: body' because gaxios typically uses `data` OR if the original used `body: string`, let's keep it.
      body: JSON.stringify(body),
      signal,
      retryConfig: {
        retryDelay,
        retry: 3,
        noResponseRetries: 3,
        statusCodesToRetry: [
          [429, 429],
          [499, 499],
          [500, 599],
        ],
      },
    })

    http.info("response", {
      provider: "google-code-assist",
      method,
      url,
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      body: JSON.stringify(res.data),
    })
    return res.data
  } catch (error) {
    const err = error as { response?: { status?: number; statusText?: string; headers?: unknown; data?: unknown } }
    http.error("response", {
      provider: "google-code-assist",
      method,
      url,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      headers: err?.response?.headers,
      body: err?.response?.data ? JSON.stringify(err.response.data) : undefined,
    })
    throw error
  }
}

export async function generate(
  cfg: ClientConfig,
  req: CAGenerateContentRequest,
  signal?: AbortSignal,
): Promise<CAGenerateContentResponse> {
  return requestPost<CAGenerateContentResponse>(
    cfg,
    methodUrl(cfg, "generateContent"),
    req,
    signal,
    GENERATE_CONTENT_RETRY_DELAY,
  )
}

export async function* stream(
  cfg: ClientConfig,
  req: CAGenerateContentRequest,
  signal?: AbortSignal,
): AsyncGenerator<CAGenerateContentResponse> {
  const http = Log.create({ service: "http" })
  const method = "POST"
  const url = methodUrl(cfg, "streamGenerateContent")

  http.info("request", {
    provider: "google-code-assist",
    method,
    url,
    body: JSON.stringify(req),
  })

  // Streaming: no retry (matches gemini-cli's retry: false)
  try {
    const res = await cfg.client.request<AsyncIterable<unknown>>({
      url,
      method,
      params: { alt: "sse" },
      headers: {
        "Content-Type": "application/json",
        ...cfg.httpOptions?.headers,
      },
      responseType: "stream",
      data: req, // using data for gaxios consistency if it helps, though body could work
      body: JSON.stringify(req),
      signal,
      retry: false,
    })

    http.info("response", {
      provider: "google-code-assist",
      method,
      url,
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      // body is a stream, so we don't log it here
    })

    // Parse SSE stream using readline — matches gemini-cli exactly
    const sourceStream = Readable.from(res.data)
    const rl = readline.createInterface({
      input: sourceStream,
      crlfDelay: Number.POSITIVE_INFINITY,
    })

    const onAbort = () => {
      try {
        sourceStream.destroy()
        rl.close()
      } catch {
        // Swallow errors during abort cleanup — the stream is being
        // forcefully torn down and errors here are expected.
      }
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort)
    }

    try {
      let bufferedLines: string[] = []
      for await (const line of rl) {
        if (line.startsWith("data: ")) {
          bufferedLines.push(line.slice(6).trim())
        } else if (line === "") {
          if (bufferedLines.length === 0) continue
          const chunk = bufferedLines.join("\n")
          try {
            const parsed = JSON.parse(chunk)
            http.info("sse", {
              provider: "google-code-assist",
              url,
              chunk: parsed,
            })
            yield parsed
          } catch (e: unknown) {
            http.error("sse parse error", {
              provider: "google-code-assist",
              url,
              chunk,
              error: e instanceof Error ? e.message : String(e),
            })
          }
          bufferedLines = []
        }
      }
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort)
    }
  } catch (error) {
    // AbortError is expected when the user cancels — don't log as error
    if (error instanceof DOMException && error.name === "AbortError") {
      http.info("stream aborted", { provider: "google-code-assist", url })
      throw error
    }
    const err = error as { response?: { status?: number; statusText?: string; headers?: unknown } }
    http.error("response", {
      provider: "google-code-assist",
      method,
      url,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      headers: err?.response?.headers,
    })
    throw error
  }
}

// VPC-SC detection — matches gemini-cli/server.ts isVpcScAffectedUser exactly.
interface VpcScErrorResponse {
  response?: {
    data?: {
      error?: {
        details?: unknown[]
      }
    }
  }
}

function isVpcScErrorResponse(error: unknown): error is VpcScErrorResponse & {
  response: { data: { error: { details: unknown[] } } }
} {
  return (
    !!error &&
    typeof error === "object" &&
    "response" in error &&
    !!error.response &&
    typeof error.response === "object" &&
    "data" in error.response &&
    !!error.response.data &&
    typeof error.response.data === "object" &&
    "error" in error.response.data &&
    !!error.response.data.error &&
    typeof error.response.data.error === "object" &&
    "details" in error.response.data.error &&
    Array.isArray(error.response.data.error.details)
  )
}

function isVpcScAffectedUser(error: unknown): boolean {
  if (isVpcScErrorResponse(error)) {
    return error.response.data.error.details.some(
      (detail: unknown) =>
        detail && typeof detail === "object" && "reason" in detail && detail.reason === "SECURITY_POLICY_VIOLATED",
    )
  }
  return false
}

export async function loadCodeAssist(cfg: ClientConfig, req: LoadCodeAssistRequest): Promise<LoadCodeAssistResponse> {
  try {
    return await requestPost<LoadCodeAssistResponse>(
      cfg,
      methodUrl(cfg, "loadCodeAssist"),
      req,
      undefined,
      DEFAULT_RETRY_DELAY,
    )
  } catch (e) {
    if (isVpcScAffectedUser(e)) {
      return { currentTier: { id: UserTierId.STANDARD } }
    }
    throw e
  }
}

export async function onboardUser(cfg: ClientConfig, req: OnboardUserRequest): Promise<LongRunningOperationResponse> {
  return requestPost<LongRunningOperationResponse>(
    cfg,
    methodUrl(cfg, "onboardUser"),
    req,
    undefined,
    DEFAULT_RETRY_DELAY,
  )
}

export interface FetchAvailableModelsResponse {
  models?: Array<{ model?: string }>
}

export async function fetchAvailableModels(cfg: ClientConfig): Promise<FetchAvailableModelsResponse> {
  return requestPost<FetchAvailableModelsResponse>(
    cfg,
    methodUrl(cfg, "fetchAvailableModels"),
    {},
    undefined,
    DEFAULT_RETRY_DELAY,
  )
}

export async function getOperation(cfg: ClientConfig, name: string): Promise<LongRunningOperationResponse> {
  const res = await cfg.client.request<LongRunningOperationResponse>({
    url: operationUrl(cfg, name),
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...cfg.httpOptions?.headers,
    },
    responseType: "json",
  })
  return res.data
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

  const lines = sources.map((s, i) => `[${i + 1}] ${s.title} (${s.uri})`)
  const output = lines.length > 0 ? `${text}\n\nSources:\n${lines.join("\n")}` : text

  return { text: output, sources }
}
