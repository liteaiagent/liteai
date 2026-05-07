import { Env } from "@/env"
import type { LoaderInput, LoaderResult } from "./types"

const DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1"

/**
 * Custom loader for LM Studio.
 *
 * Declares `dynamicModels` so the orchestrator auto-fetches available models
 * from LM Studio's OpenAI-compatible `/v1/models` endpoint.
 * Uses a short timeout since LM Studio is a local server.
 */
export async function lmstudio(input: LoaderInput): Promise<LoaderResult> {
  const baseUrl = input.options.api ?? Env.get("LMSTUDIO_API_URL") ?? DEFAULT_BASE_URL

  return {
    autoload: false,
    dynamicModels: {
      baseUrl,
      timeout: 3000, // LM Studio is local — should respond fast
    },
    options: {},
  }
}
