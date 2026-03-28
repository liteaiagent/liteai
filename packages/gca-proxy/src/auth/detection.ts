/**
 * Auth mode detection — determines API-key, OAuth, Vertex AI, or Compute ADC mode.
 *
 * Detection priority matches gemini-cli:
 * 1. GOOGLE_GENAI_USE_GCA=true → oauth
 * 2. GOOGLE_GENAI_USE_VERTEXAI=true → vertex-ai
 * 3. GEMINI_API_KEY set → api-key
 * 4. CLOUD_SHELL=true or GEMINI_CLI_USE_COMPUTE_ADC=true → compute-adc
 * 5. Default → oauth
 */

import { createLogger } from "../core/logger.js"

const logger = createLogger("auth.detection")

export type AuthMode = "api-key" | "oauth" | "vertex-ai" | "compute-adc"

export function detectAuthMode(): AuthMode {
  const useGca = process.env.GOOGLE_GENAI_USE_GCA || ""
  const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI || ""
  const apiKey = process.env.GEMINI_API_KEY || ""
  const googleApiKey = process.env.GOOGLE_API_KEY || ""
  const cloudShell = process.env.CLOUD_SHELL || ""
  const useComputeAdc = process.env.GEMINI_CLI_USE_COMPUTE_ADC || ""

  // 1. Explicit GCA (OAuth via Code Assist)
  if (useGca === "true") return "oauth"

  // 2. Vertex AI
  if (useVertex === "true") return "vertex-ai"

  // 3. API Key (GEMINI_API_KEY or GOOGLE_API_KEY)
  if (apiKey || googleApiKey) return "api-key"

  // 4. Compute ADC (Cloud Shell or explicit flag)
  if (cloudShell === "true" || useComputeAdc === "true") {
    logger.info("Detected Compute ADC mode (CLOUD_SHELL or GEMINI_CLI_USE_COMPUTE_ADC)")
    return "compute-adc"
  }

  // 5. Default to OAuth (GCA)
  logger.info("No explicit authentication configured — defaulting to OAuth (GOOGLE_GENAI_USE_GCA)")
  process.env.GOOGLE_GENAI_USE_GCA = "true"
  return "oauth"
}
