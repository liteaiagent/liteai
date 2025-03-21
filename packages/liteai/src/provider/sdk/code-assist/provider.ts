// Factory function creating a Code Assist AI SDK provider.
// The provider speaks the Gemini API via cloudcode-pa.googleapis.com
// and is registered as a bundled provider under "@ai-sdk/google-code-assist".

import type { LanguageModelV2, ProviderV2 } from "@ai-sdk/provider"
import type { FetchFunction } from "@ai-sdk/provider-utils"
import { CodeAssistLanguageModel } from "./language-model"

export interface CodeAssistSettings {
  /** Provider name used for metadata tagging. */
  name?: string
  /** GCP project ID for Code Assist. */
  project?: string
  /** API key — unused for CA (bearer token injected via custom fetch). */
  apiKey?: string
  /** Custom fetch function (auth plugin injects bearer token here). */
  fetch?: FetchFunction
  /** Override the API endpoint. */
  baseURL?: string
  /** Custom headers. */
  headers?: Record<string, string>
}

export interface CodeAssistProvider extends ProviderV2 {
  (modelId: string): LanguageModelV2
  languageModel(modelId: string): LanguageModelV2
  chat(modelId: string): LanguageModelV2
}

export function createCodeAssist(settings: CodeAssistSettings = {}): CodeAssistProvider {
  const name = settings.name ?? "google-code-assist"

  const create = (modelId: string): LanguageModelV2 =>
    new CodeAssistLanguageModel({
      provider: `${name}.chat`,
      model: modelId,
      project: settings.project,
      fetch: settings.fetch,
      endpoint: settings.baseURL,
      headers: () => ({
        ...settings.headers,
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      }),
    })

  const provider = ((modelId: string) => create(modelId)) as CodeAssistProvider

  provider.languageModel = create
  provider.chat = create

  return provider
}
