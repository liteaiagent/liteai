import type { LoaderResult, SDK } from "./types"
import { useLanguageModel } from "./types"

export async function googleCodeAssist(): Promise<LoaderResult> {
  return {
    autoload: false,
    async getModel(sdk: SDK, modelID: string) {
      if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
      return sdk.chat?.(modelID)
    },
    options: {},
  }
}
