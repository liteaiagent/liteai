import { Env } from "@/env"
import { iife } from "@/util/iife"
import type { LoaderInput, LoaderResult, SDK } from "./types"
import { useLanguageModel } from "./types"

export async function azure(input: LoaderInput): Promise<LoaderResult> {
  const resource = iife(() => {
    const name = input.options?.resourceName
    if (typeof name === "string" && name.trim() !== "") return name
    return Env.get("AZURE_RESOURCE_NAME")
  })

  return {
    autoload: false,
    async getModel(sdk: SDK, modelID: string, options?: Record<string, unknown>) {
      if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
      if (options?.useCompletionUrls) {
        return sdk.chat?.(modelID)
      } else {
        return sdk.responses?.(modelID)
      }
    },
    options: {},
    vars() {
      return {
        ...(resource && { AZURE_RESOURCE_NAME: resource }),
      }
    },
  }
}

export async function azureCognitiveServices(): Promise<LoaderResult> {
  const name = Env.get("AZURE_COGNITIVE_SERVICES_RESOURCE_NAME")
  return {
    autoload: false,
    async getModel(sdk: SDK, modelID: string, options?: Record<string, unknown>) {
      if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
      if (options?.useCompletionUrls) {
        return sdk.chat?.(modelID)
      } else {
        return sdk.responses?.(modelID)
      }
    },
    options: {
      baseURL: name ? `https://${name}.cognitiveservices.azure.com/openai` : undefined,
    },
  }
}
