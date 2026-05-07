import type { LanguageModelV2 } from "@ai-sdk/provider"
import type { Provider } from "../provider"

export type SDK = {
  languageModel(id: string): LanguageModelV2
  responses?(id: string): LanguageModelV2
  chat?(id: string): LanguageModelV2
  agenticChat?(id: string, opts?: Record<string, unknown>): LanguageModelV2
  (id: string): LanguageModelV2
}

export type ModelLoader = (
  sdk: SDK,
  modelID: string,
  // biome-ignore lint/suspicious/noExplicitAny: options bags are untyped provider config
  options?: Record<string, any>,
) => Promise<LanguageModelV2 | undefined>

// biome-ignore lint/suspicious/noExplicitAny: options bags are untyped provider config
export type VarsLoader = (options: Record<string, any>) => Record<string, string>

export interface DynamicModelsConfig {
  /** Base URL for the /v1/models endpoint. If omitted, derived from provider's api URL. */
  baseUrl?: string
  /** API key for authenticated providers. If omitted, uses the provider's resolved key. */
  apiKey?: string
  /** Request timeout in milliseconds. Default: 5000. */
  timeout?: number
  /** Additional headers to send with the fetch request. */
  headers?: Record<string, string>
  /** Fallback model IDs to use if the fetch fails. If omitted, falls back to models.dev. */
  fallbackModelIds?: string[]
}

export interface LoaderResult {
  autoload: boolean
  getModel?: ModelLoader
  vars?: VarsLoader
  // biome-ignore lint/suspicious/noExplicitAny: options bags are untyped provider config
  options?: Record<string, any>
  /** Provider-supplied model list — overrides models.dev entries for this provider */
  models?: Record<string, Provider.Model>
  /**
   * Enable dynamic model fetching from the provider's OpenAI-compatible /v1/models endpoint.
   * When set, the orchestrator will fetch model IDs from the API and build Provider.Model
   * entries with sensible defaults. Fetched models fully replace the models.dev list.
   * If the fetch fails, falls back to `fallbackModelIds` → `models` → static models.dev list.
   */
  dynamicModels?: DynamicModelsConfig
}

export interface LoaderInput {
  id: string
  env: string[]
  // biome-ignore lint/suspicious/noExplicitAny: models bag is untyped
  models: Record<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: options bags are untyped provider config
  options: Record<string, any>
}

export type CustomLoader = (input: LoaderInput, database: Record<string, Provider.Info>) => Promise<LoaderResult>

export function useLanguageModel(sdk: SDK) {
  return sdk.responses === undefined && sdk.chat === undefined
}

export function shouldUseCopilotResponsesApi(modelID: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}
