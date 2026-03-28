import type { LoaderResult, SDK } from "./types"
import { shouldUseCopilotResponsesApi, useLanguageModel } from "./types"

export async function githubCopilot(): Promise<LoaderResult> {
  return {
    autoload: false,
    async getModel(sdk: SDK, modelID: string) {
      if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
      return shouldUseCopilotResponsesApi(modelID) ? sdk.responses?.(modelID) : sdk.chat?.(modelID)
    },
    options: {},
  }
}

export async function githubCopilotEnterprise(): Promise<LoaderResult> {
  return {
    autoload: false,
    async getModel(sdk: SDK, modelID: string) {
      if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
      return shouldUseCopilotResponsesApi(modelID) ? sdk.responses?.(modelID) : sdk.chat?.(modelID)
    },
    options: {},
  }
}
