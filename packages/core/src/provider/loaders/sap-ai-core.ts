import { Auth } from "@/auth"
import { iife } from "@/util/iife"
import type { LoaderResult, SDK } from "./types"

export async function sapAiCore(): Promise<LoaderResult> {
  const auth = await Auth.get("sap-ai-core")
  // TODO: Using process.env directly because Env.set only updates a shallow copy (not process.env),
  // until the scope of the Env API is clarified (test only or runtime?)
  const key = iife(() => {
    const envAICoreServiceKey = process.env.AICORE_SERVICE_KEY
    if (envAICoreServiceKey) return envAICoreServiceKey
    if (auth?.type === "api") {
      process.env.AICORE_SERVICE_KEY = auth.key
      return auth.key
    }
    return undefined
  })
  const deploymentId = process.env.AICORE_DEPLOYMENT_ID
  const resourceGroup = process.env.AICORE_RESOURCE_GROUP

  return {
    autoload: !!key,
    options: key ? { deploymentId, resourceGroup } : {},
    async getModel(sdk: SDK, modelID: string) {
      return sdk(modelID)
    },
  }
}
