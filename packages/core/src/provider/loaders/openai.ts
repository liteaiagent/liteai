import type { LoaderResult, SDK } from "./types"

export async function openai(): Promise<LoaderResult> {
  return {
    autoload: false,
    async getModel(sdk: SDK, modelID: string) {
      return sdk.responses?.(modelID)
    },
    options: {},
  }
}
