import type { LanguageModelV2 } from "@ai-sdk/provider"

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

export interface LoaderResult {
  autoload: boolean
  getModel?: ModelLoader
  vars?: VarsLoader
  // biome-ignore lint/suspicious/noExplicitAny: options bags are untyped provider config
  options?: Record<string, any>
}

export interface LoaderInput {
  id: string
  env: string[]
  // biome-ignore lint/suspicious/noExplicitAny: models bag is untyped
  models: Record<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: options bags are untyped provider config
  options: Record<string, any>
}

export type CustomLoader = (input: LoaderInput) => Promise<LoaderResult>

export function useLanguageModel(sdk: SDK) {
  return sdk.responses === undefined && sdk.chat === undefined
}

export function shouldUseCopilotResponsesApi(modelID: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}
