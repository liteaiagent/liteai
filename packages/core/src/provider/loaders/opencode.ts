import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "@/env"
import type { LoaderInput, LoaderResult } from "./types"

export async function opencode(input: LoaderInput): Promise<LoaderResult> {
  const env = Env.all()
  const hasEnv = input.env.some((item) => env[item])
  const auth = await Auth.get(input.id)
  const config = await Config.get()
  const hasConfig = !!config.provider?.opencode?.options?.apiKey

  const connected = hasEnv || !!auth || hasConfig
  if (!connected) return { autoload: false }

  const hasKey = hasEnv || hasConfig || (auth?.type === "api" && auth.key !== "public")

  if (!hasKey) {
    for (const [key, value] of Object.entries(input.models)) {
      if (value.cost.input === 0) continue
      delete input.models[key]
    }
  }

  return {
    autoload: Object.keys(input.models).length > 0,
    options: hasKey ? {} : { apiKey: "public" },
  }
}
