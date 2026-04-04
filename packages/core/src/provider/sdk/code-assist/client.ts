// HTTP client for the Code Assist API (cloudcode-pa.googleapis.com).
// Uses google-auth-library's AuthClient (gaxios) to match gemini-cli exactly.

import * as readline from "node:readline"
import { Readable } from "node:stream"
import type { AuthClient } from "google-auth-library"
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
  const res = await cfg.client.request<T>({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...cfg.httpOptions?.headers,
    },
    responseType: "json",
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
  return res.data
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
  // Streaming: no retry (matches gemini-cli's retry: false)
  const res = await cfg.client.request<AsyncIterable<unknown>>({
    url: methodUrl(cfg, "streamGenerateContent"),
    method: "POST",
    params: { alt: "sse" },
    headers: {
      "Content-Type": "application/json",
      ...cfg.httpOptions?.headers,
    },
    responseType: "stream",
    body: JSON.stringify(req),
    signal,
    retry: false,
  })

  // Parse SSE stream using readline — matches gemini-cli exactly
  const rl = readline.createInterface({
    input: Readable.from(res.data),
    crlfDelay: Number.POSITIVE_INFINITY,
  })

  let bufferedLines: string[] = []
  for await (const line of rl) {
    if (line.startsWith("data: ")) {
      bufferedLines.push(line.slice(6).trim())
    } else if (line === "") {
      if (bufferedLines.length === 0) continue
      const chunk = bufferedLines.join("\n")
      try {
        yield JSON.parse(chunk)
      } catch {
        // Skip unparseable chunks (e.g. [DONE])
      }
      bufferedLines = []
    }
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
