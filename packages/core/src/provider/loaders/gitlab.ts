import os from "node:os"
import { type createGitLab, VERSION as GITLAB_PROVIDER_VERSION } from "@gitlab/gitlab-ai-provider"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "@/env"
import { Installation } from "@/installation"
import type { LoaderInput, LoaderResult, SDK } from "./types"

export async function gitlab(input: LoaderInput): Promise<LoaderResult> {
  const instanceUrl = Env.get("GITLAB_INSTANCE_URL") || "https://gitlab.com"

  const auth = await Auth.get(input.id)
  const apiKey = await (async () => {
    if (auth?.type === "oauth") return auth.access
    if (auth?.type === "api") return auth.key
    return Env.get("GITLAB_TOKEN")
  })()

  const config = await Config.get()
  const cfg = config.provider?.gitlab

  const headers = {
    "User-Agent": `liteai/${Installation.VERSION} gitlab-ai-provider/${GITLAB_PROVIDER_VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
    "anthropic-beta": "context-1m-2025-08-07",
    ...(cfg?.options?.aiGatewayHeaders || {}),
  }

  const flags = {
    duo_agent_platform_agentic_chat: true,
    duo_agent_platform: true,
    ...(cfg?.options?.featureFlags || {}),
  }

  return {
    autoload: !!apiKey,
    options: {
      instanceUrl,
      apiKey,
      aiGatewayHeaders: headers,
      featureFlags: flags,
    },
    async getModel(sdk: SDK, modelID: string) {
      const gl = sdk as ReturnType<typeof createGitLab>
      return gl.agenticChat(modelID, {
        aiGatewayHeaders: headers,
        featureFlags: flags,
      })
    },
  }
}
