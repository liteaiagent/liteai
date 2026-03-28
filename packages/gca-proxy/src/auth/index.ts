/**
 * Authentication — client factories and state management.
 *
 * Port of liteai/auth/__init__.py
 */

import { GoogleGenAI } from "@google/genai"
import { type AuthClient, Compute } from "google-auth-library"
import type { GeminiUserTier } from "../core/billing.js"
import { settings } from "../core/config.js"
import { createLogger } from "../core/logger.js"
import { CodeAssistClient } from "./code-assist-client.js"
import { loadOauthCredentials } from "./credentials.js"
import { type AuthMode, detectAuthMode } from "./detection.js"

const logger = createLogger("auth")

// ── Cached State ───────────────────────────────────────────────────────────

let _cachedAuthMode: AuthMode | null = null
let _cachedCodeAssistClient: CodeAssistClient | null = null
let _pendingCodeAssistClient: Promise<CodeAssistClient> | null = null
let _cachedGenaiClient: GoogleGenAI | null = null
let _cachedProjectId: string | null = null
let _cachedUserEmail: string | null = null
let _cachedUserTier: string | null = null
let _cachedPaidTier: GeminiUserTier | null = null

// ── Auth Mode ──────────────────────────────────────────────────────────────

export function getAuthMode(): AuthMode {
  if (!_cachedAuthMode) {
    _cachedAuthMode = detectAuthMode()
    logger.info(`Auth mode: ${_cachedAuthMode}`)
  }
  return _cachedAuthMode
}

// ── Client Factories ───────────────────────────────────────────────────────

export async function getCodeAssistClient(): Promise<CodeAssistClient> {
  if (_cachedCodeAssistClient) return _cachedCodeAssistClient
  if (_pendingCodeAssistClient) return _pendingCodeAssistClient

  _pendingCodeAssistClient = (async () => {
    try {
      const mode = getAuthMode()
      let authClient: AuthClient

      if (mode === "compute-adc") {
        // Compute ADC — use the metadata server for authentication
        logger.info("Using Compute ADC (metadata server) for Code Assist")
        authClient = new Compute()
      } else {
        // OAuth2Client extends AuthClient — CodeAssistClient accepts AuthClient
        authClient = await loadOauthCredentials()
      }

      const projectId = settings.google_cloud_project || settings.google_cloud_project_id || null

      const client = new CodeAssistClient(authClient, projectId)

      // Full setup flow matching gemini-cli/packages/core/src/code_assist/setup.ts
      try {
        const info = await client.loadCodeAssist()

        // 1. Extract project ID
        const discoveredProject = (info.cloudaicompanionProject ?? info.cloudAiCompanionProject) as string | undefined
        if (discoveredProject) {
          _cachedProjectId = discoveredProject
          client.projectId = _cachedProjectId
          logger.info(`Code Assist project: ${_cachedProjectId}`)
        }

        // 2. Determine user tier (paidTier takes precedence, matching gemini-cli)
        const currentTier = info.currentTier as Record<string, unknown> | undefined
        const paidTier = info.paidTier as Record<string, unknown> | undefined
        const tierId = (paidTier?.id ?? currentTier?.id ?? "standard-tier") as string
        const tierName = (paidTier?.name ?? currentTier?.name ?? "Standard") as string
        _cachedUserTier = tierId
        _cachedPaidTier = (paidTier as GeminiUserTier | null) ?? null
        logger.info(`User tier: ${tierId} (${tierName})`)

        // 3. If no currentTier, user needs onboarding (matching gemini-cli setup.ts)
        if (!currentTier) {
          const allowedTiers = (info.allowedTiers ?? []) as Array<Record<string, unknown>>
          const defaultTier = allowedTiers.find((t) => t.isDefault) ?? {
            id: "standard-tier",
            name: "Standard",
            userDefinedCloudaicompanionProject: true,
          }
          const onboardTierId = (defaultTier.id ?? "standard-tier") as string
          logger.info(`Onboarding user with tier: ${onboardTierId}`)

          try {
            const lroRes = await client.onboardUser(onboardTierId, projectId)
            // Check if LRO completed
            if (lroRes.done === false && lroRes.name) {
              // Poll until done
              let opRes = lroRes
              while (!opRes.done) {
                await new Promise((r) => setTimeout(r, 5000))
                opRes = await client.getOperation(lroRes.name as string)
              }
            }
            // Extract project from onboard response
            const responseData = lroRes.response as Record<string, unknown> | undefined
            const onboardProject = responseData?.cloudaicompanionProject as Record<string, unknown> | undefined
            if (onboardProject?.id && !_cachedProjectId) {
              _cachedProjectId = onboardProject.id as string
              client.projectId = _cachedProjectId
              logger.info(`Onboarded project: ${_cachedProjectId}`)
            }
          } catch (onboardErr) {
            logger.warn(`onboardUser failed: ${onboardErr}`)
          }
        }
      } catch (err) {
        logger.warn(`loadCodeAssist failed: ${err}`)
      }

      _cachedCodeAssistClient = client
      return client
    } catch (err) {
      // Clear pending so subsequent calls can retry
      _pendingCodeAssistClient = null
      throw err
    }
  })()

  return _pendingCodeAssistClient
}

export function getGenaiClient(): GoogleGenAI {
  if (_cachedGenaiClient) return _cachedGenaiClient

  const mode = getAuthMode()
  const customHeaders = parseCustomHeaders(settings.custom_headers)
  const apiVersion = settings.google_genai_api_version || undefined

  if (mode === "api-key") {
    const apiKey = settings.gemini_api_key || settings.google_api_key
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is not set. Use GOOGLE_GENAI_USE_GCA=true for OAuth mode.")
    }

    // Bearer auth mode: inject Authorization header instead of x-goog-api-key
    if (settings.api_key_auth_mechanism === "bearer") {
      _cachedGenaiClient = new GoogleGenAI({
        apiKey: undefined,
        httpOptions: {
          headers: {
            ...customHeaders,
            Authorization: `Bearer ${apiKey}`,
          },
          baseUrl: settings.http_proxy || undefined,
          apiVersion,
        },
      })
      logger.info("Created GenAI client with bearer auth")
    } else {
      _cachedGenaiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: customHeaders,
          apiVersion,
        },
      })
      logger.info("Created GenAI client with API key")
    }
    return _cachedGenaiClient
  }

  if (mode === "vertex-ai") {
    const project = settings.google_cloud_project || settings.google_cloud_project_id
    const location = settings.google_cloud_location
    if (!project) {
      throw new Error("GOOGLE_CLOUD_PROJECT is required for Vertex AI mode.")
    }
    _cachedGenaiClient = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      httpOptions: {
        headers: customHeaders,
        apiVersion,
      },
    })
    logger.info(`Created GenAI client for Vertex AI (project=${project})`)
    return _cachedGenaiClient
  }

  if (mode === "compute-adc") {
    const project = settings.google_cloud_project || settings.google_cloud_project_id
    _cachedGenaiClient = new GoogleGenAI({
      vertexai: true,
      project: project || undefined,
      location: settings.google_cloud_location,
      httpOptions: {
        headers: customHeaders,
        apiVersion,
      },
    })
    logger.info(`Created GenAI client for Compute ADC (project=${project || "auto"})`)
    return _cachedGenaiClient
  }

  // OAuth mode — don't use GenAI SDK directly (use CodeAssistClient)
  throw new Error(
    "OAuth mode uses CodeAssistClient, not the GenAI SDK directly. " + "Use getCodeAssistClient() instead.",
  )
}

// ── Cache Reset (for login/logout) ─────────────────────────────────────────

/**
 * Reset cached auth state, forcing re-initialization on next request.
 */
export function resetAuthState(): void {
  _cachedCodeAssistClient = null
  _pendingCodeAssistClient = null
  _cachedGenaiClient = null
  _cachedProjectId = null
  _cachedUserEmail = null
  _cachedUserTier = null
  _cachedPaidTier = null
  _cachedAuthMode = null
  logger.info("Auth state reset")
}

// ── User Info ──────────────────────────────────────────────────────────────

export function getUserEmail(): string | null {
  return _cachedUserEmail
}

export function setUserEmail(email: string | null): void {
  _cachedUserEmail = email
}

export function getUserTier(): string | null {
  return _cachedUserTier
}

export function getProjectId(): string | null {
  return _cachedProjectId
}

export function getPaidTier(): GeminiUserTier | null {
  return _cachedPaidTier
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse custom headers from a JSON string.
 * Matching gemini-cli GEMINI_CLI_CUSTOM_HEADERS.
 */
function parseCustomHeaders(value: string): Record<string, string> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Record<string, string>
    if (typeof parsed === "object" && parsed !== null) {
      logger.info(`Custom headers: ${Object.keys(parsed).join(", ")}`)
      return parsed
    }
  } catch {
    logger.warn(`Failed to parse GEMINI_CLI_CUSTOM_HEADERS: ${value}`)
  }
  return undefined
}

// ── Re-exports ─────────────────────────────────────────────────────────────

export { CodeAssistClient } from "./code-assist-client.js"
export type { AuthMode } from "./detection.js"
