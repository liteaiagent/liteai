/**
 * Client for the Google Code Assist endpoint.
 *
 * Aligned with gemini-cli/packages/core/src/code_assist/server.ts:
 * - Uses AuthClient.request() with built-in retry
 * - Uses ca-converter for SDK ↔ Code Assist type mapping
 * - readline-based SSE parsing
 * - Code Assist API features (admin controls, user settings, experiments, quota)
 * - VPC-SC graceful fallback
 */

import { randomUUID } from "node:crypto"
import { arch, platform } from "node:os"
import * as readline from "node:readline"
import { Readable } from "node:stream"
import type {
  CountTokensParameters,
  CountTokensResponse,
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai"
import type { AuthClient } from "google-auth-library"
import {
  type CaCountTokenResponse,
  type CaGenerateContentResponse,
  fromCountTokenResponse,
  fromGenerateContentResponse,
  toCountTokenRequest,
  toGenerateContentRequest,
} from "../core/ca-converter.js"
import { createLogger } from "../core/logger.js"
import { ProjectPermissionError, raiseIfPermissionDenied } from "./retry.js"

// ── Code Assist API Types ───────────────────────────────────────────────────
// Matching gemini-cli/packages/core/src/code_assist/types.ts

export interface ClientMetadata {
  ideType?: string
  ideVersion?: string
  pluginVersion?: string
  platform?: string
  updateChannel?: string
  duetProject?: string
  pluginType?: string
  ideName?: string
}

export interface FetchAdminControlsRequest {
  project: string
}

export interface FetchAdminControlsResponse {
  secureModeEnabled?: boolean
  strictModeDisabled?: boolean
  mcpSetting?: {
    mcpEnabled?: boolean
    mcpConfigJson?: string
  }
  cliFeatureSetting?: {
    extensionsSetting?: { extensionsEnabled?: boolean }
    unmanagedCapabilitiesEnabled?: boolean
  }
  adminControlsApplicable?: boolean
}

export interface CodeAssistGlobalUserSettingRequest {
  cloudaicompanionProject?: string
  freeTierDataCollectionOptin?: boolean
}

export interface CodeAssistGlobalUserSettingResponse {
  cloudaicompanionProject?: string
  freeTierDataCollectionOptin?: boolean
}

export interface ListExperimentsRequest {
  project: string
  metadata?: ClientMetadata
}

export interface ListExperimentsResponse {
  experimentIds?: number[]
  flags?: Array<{
    flagId?: number
    boolValue?: boolean
    floatValue?: number
    intValue?: string
    stringValue?: string
  }>
  filteredFlags?: Array<{ name?: string; reason?: string }>
  debugString?: string
}

export interface RetrieveUserQuotaRequest {
  project: string
  userAgent?: string
}

export interface RetrieveUserQuotaResponse {
  buckets?: Array<{
    remainingAmount?: string
    remainingFraction?: number
    resetTime?: string
    tokenType?: string
    modelId?: string
  }>
}

const logger = createLogger("auth.code_assist_client")

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = "v1internal"

export class CodeAssistClient {
  private authClient: AuthClient
  public projectId: string | null

  constructor(authClient: AuthClient, projectId: string | null = null) {
    this.authClient = authClient
    this.projectId = projectId
  }

  getSessionId(_user?: string | null): string {
    return randomUUID()
  }

  // ── URL Helpers ──────────────────────────────────────────────────────────

  private getBaseUrl(): string {
    const endpoint = process.env.CODE_ASSIST_ENDPOINT || CODE_ASSIST_ENDPOINT
    const version = process.env.CODE_ASSIST_API_VERSION || CODE_ASSIST_API_VERSION
    return `${endpoint}/${version}`
  }

  private getMethodUrl(method: string): string {
    return `${this.getBaseUrl()}:${method}`
  }

  private getOperationUrl(name: string): string {
    return `${this.getBaseUrl()}/${name}`
  }

  // ── Generic Request Methods ──────────────────────────────────────────────

  /**
   * JSON POST with automatic auth and retry (matching gemini-cli).
   */
  async requestPost<T>(method: string, body: object, retryDelay = 1000): Promise<T> {
    const url = this.getMethodUrl(method)
    logger.debug(`POST ${url} body=${JSON.stringify(body).slice(0, 2000)}`)

    try {
      const res = await this.authClient.request<T>({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `GeminiCLI/1.0.0/lite-agent (${platform()}; ${arch()})`,
        },
        body: JSON.stringify(body),
        responseType: "json",
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
      logger.debug(`POST ${url} → OK`)
      return res.data
    } catch (err) {
      this.handleRequestError(err, method)
      throw err // re-throw if handleRequestError didn't
    }
  }

  /**
   * JSON GET with automatic auth.
   */
  async requestGet<T>(url: string): Promise<T> {
    logger.debug(`GET ${url}`)
    const res = await this.authClient.request<T>({
      url,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `GeminiCLI/1.0.0/lite-agent (${platform()}; ${arch()})`,
      },
      responseType: "json",
    })
    logger.debug(`GET ${url} → OK`)
    return res.data
  }

  /**
   * Streaming POST using SSE (alt=sse) with readline-based parsing.
   * Matching gemini-cli's requestStreamingPost pattern.
   */
  async *requestStreamingPost<T>(method: string, body: object): AsyncGenerator<T> {
    const url = this.getMethodUrl(method)
    const bodyJson = JSON.stringify(body)
    logger.debug(`POST ${url}?alt=sse body=${bodyJson.slice(0, 2000)}`)

    const res = await this.authClient.request<AsyncIterable<unknown>>({
      url,
      method: "POST",
      params: { alt: "sse" },
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `GeminiCLI/1.0.0/lite-agent (${platform()}; ${arch()})`,
      },
      responseType: "stream",
      body: bodyJson,
      retry: false,
    })

    logger.debug(`POST ${url}?alt=sse → streaming`)

    const rl = readline.createInterface({
      input: Readable.from(res.data),
      crlfDelay: Number.POSITIVE_INFINITY,
    })

    let bufferedLines: string[] = []
    let yieldCount = 0

    for await (const line of rl) {
      if (line.startsWith("data: ")) {
        bufferedLines.push(line.slice(6).trim())
      } else if (line === "") {
        if (bufferedLines.length === 0) {
          continue
        }
        const chunkJson = bufferedLines.join("\n")
        const parsed = JSON.parse(chunkJson) as Record<string, unknown>
        // Summarise parts for debug (detect thought vs text vs fc)
        const resp = (parsed.response ?? parsed) as Record<string, unknown>
        const candidates = resp.candidates as Array<Record<string, unknown>> | undefined
        const parts = (candidates?.[0]?.content as Record<string, unknown>)?.parts as
          | Array<Record<string, unknown>>
          | undefined
        const partsSummary =
          parts
            ?.map((p) => {
              if (p.thought) return `thought(${String(p.text ?? "").length}c)`
              if (p.text !== undefined) return `text(${String(p.text).length}c)`
              if (p.functionCall) return `fc(${(p.functionCall as Record<string, unknown>).name})`
              return "other"
            })
            .join(", ") ?? "no-parts"
        logger.debug(`SSE chunk ${yieldCount}: [${partsSummary}]`)
        yieldCount++
        yield parsed as T
        bufferedLines = []
      }
    }

    logger.debug(`SSE stream done. Total yields: ${yieldCount}`)
  }

  /**
   * Handle error responses — check for permission denied.
   */
  private handleRequestError(err: unknown, method: string): void {
    // google-auth-library wraps errors in a GaxiosError with response.data
    const gaxiosErr = err as {
      response?: { status?: number; data?: unknown }
    }
    const status = gaxiosErr?.response?.status
    const data = gaxiosErr?.response?.data

    if (status) {
      logger.error(`${method} error ${status}: ${JSON.stringify(data).slice(0, 2000)}`)
    }

    if (status === 403 && data && typeof data === "object") {
      try {
        raiseIfPermissionDenied(data as Record<string, unknown>, this.projectId)
      } catch (e) {
        if (e instanceof ProjectPermissionError) throw e
      }
    }
  }

  // ── Content Generation ───────────────────────────────────────────────────

  async generateContent(req: GenerateContentParameters): Promise<GenerateContentResponse> {
    const caRequest = toGenerateContentRequest(req, randomUUID(), this.projectId ?? undefined, this.getSessionId())

    const raw = await this.requestPost<CaGenerateContentResponse>("generateContent", caRequest)

    return fromGenerateContentResponse(raw)
  }

  async *generateContentStream(req: GenerateContentParameters): AsyncGenerator<GenerateContentResponse> {
    const caRequest = toGenerateContentRequest(req, randomUUID(), this.projectId ?? undefined, this.getSessionId())

    for await (const chunk of this.requestStreamingPost<CaGenerateContentResponse>(
      "streamGenerateContent",
      caRequest,
    )) {
      yield fromGenerateContentResponse(chunk)
    }
  }

  async countTokens(req: CountTokensParameters): Promise<CountTokensResponse> {
    const raw = await this.requestPost<CaCountTokenResponse>("countTokens", toCountTokenRequest(req))
    return fromCountTokenResponse(raw)
  }

  // ── Code Assist Setup ────────────────────────────────────────────────────

  /**
   * Load Code Assist configuration (tier, project, etc.).
   * Includes VPC-SC graceful fallback (matching gemini-cli's server.ts).
   */
  async loadCodeAssist(
    mode?: "MODE_UNSPECIFIED" | "FULL_ELIGIBILITY_CHECK" | "HEALTH_CHECK",
  ): Promise<Record<string, unknown>> {
    const metadata: Record<string, string> = {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }
    const body: Record<string, unknown> = { metadata }
    if (this.projectId) {
      body.cloudaicompanionProject = this.projectId
      metadata.duetProject = this.projectId
    }
    if (mode) {
      body.mode = mode
    }

    logger.info(`loadCodeAssist request project=${this.projectId}`)
    try {
      return await this.requestPost<Record<string, unknown>>("loadCodeAssist", body)
    } catch (err) {
      // VPC-SC graceful fallback (matching gemini-cli)
      if (isVpcScAffectedUser(err)) {
        logger.warn("VPC-SC SECURITY_POLICY_VIOLATED — falling back to standard tier")
        return { currentTier: { id: "standard-tier" } }
      }
      throw err
    }
  }

  async onboardUser(tierId: string, projectId: string | null = null): Promise<Record<string, unknown>> {
    const metadata: Record<string, string> = {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }
    const body: Record<string, unknown> = { tierId, metadata }
    if (projectId) {
      body.cloudaicompanionProject = projectId
      metadata.duetProject = projectId
    }

    logger.info(`onboardUser request tier=${tierId}, project=${projectId}`)
    return this.requestPost<Record<string, unknown>>("onboardUser", body)
  }

  async getOperation(name: string): Promise<Record<string, unknown>> {
    return this.requestGet<Record<string, unknown>>(this.getOperationUrl(name))
  }

  // ── Code Assist API Features ─────────────────────────────────────────────

  /**
   * Fetch admin controls for the project.
   * Returns enterprise policy settings (strict mode, MCP config, etc.).
   */
  async fetchAdminControls(req: FetchAdminControlsRequest): Promise<FetchAdminControlsResponse> {
    return this.requestPost<FetchAdminControlsResponse>("fetchAdminControls", req)
  }

  /**
   * Get global user settings from Code Assist.
   */
  async getCodeAssistGlobalUserSetting(): Promise<CodeAssistGlobalUserSettingResponse> {
    return this.requestPost<CodeAssistGlobalUserSettingResponse>("getCodeAssistGlobalUserSetting", {})
  }

  /**
   * Update global user settings on Code Assist.
   */
  async setCodeAssistGlobalUserSetting(
    req: CodeAssistGlobalUserSettingRequest,
  ): Promise<CodeAssistGlobalUserSettingResponse> {
    return this.requestPost<CodeAssistGlobalUserSettingResponse>("setCodeAssistGlobalUserSetting", req)
  }

  /**
   * List active experiments for the project.
   */
  async listExperiments(metadata?: ClientMetadata): Promise<ListExperimentsResponse> {
    if (!this.projectId) {
      throw new Error("projectId is required for listExperiments")
    }
    const req: ListExperimentsRequest = {
      project: this.projectId,
      metadata: {
        ...metadata,
        duetProject: this.projectId,
      },
    }
    return this.requestPost<ListExperimentsResponse>("listExperiments", req)
  }

  /**
   * Retrieve user quota information.
   */
  async retrieveUserQuota(): Promise<RetrieveUserQuotaResponse> {
    if (!this.projectId) {
      throw new Error("projectId is required for retrieveUserQuota")
    }
    const req: RetrieveUserQuotaRequest = {
      project: this.projectId,
    }
    return this.requestPost<RetrieveUserQuotaResponse>("retrieveUserQuota", req)
  }
}

// ── VPC-SC Detection ──────────────────────────────────────────────────────
// Matching gemini-cli/packages/core/src/code_assist/server.ts

function isVpcScAffectedUser(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return false
  }

  const resp = (error as { response?: { data?: { error?: { details?: unknown[] } } } }).response
  const details = resp?.data?.error?.details
  if (!Array.isArray(details)) return false

  return details.some(
    (detail: unknown) =>
      detail &&
      typeof detail === "object" &&
      "reason" in detail &&
      (detail as { reason?: string }).reason === "SECURITY_POLICY_VIOLATED",
  )
}
