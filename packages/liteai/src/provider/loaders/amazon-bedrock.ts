import type { AmazonBedrockProviderSettings } from "@ai-sdk/amazon-bedrock"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "@/env"
import { iife } from "@/util/iife"
import type { LoaderResult, SDK } from "./types"

export async function amazonBedrock(): Promise<LoaderResult> {
  const config = await Config.get()
  const cfg = config.provider?.["amazon-bedrock"]

  const auth = await Auth.get("amazon-bedrock")

  // Region precedence: 1) config file, 2) env var, 3) default
  const region = cfg?.options?.region ?? Env.get("AWS_REGION") ?? "us-east-1"

  // Profile: config file takes precedence over env var
  const profile = cfg?.options?.profile ?? Env.get("AWS_PROFILE")

  const accessKey = Env.get("AWS_ACCESS_KEY_ID")

  // TODO: Using process.env directly because Env.set only updates a process.env shallow copy,
  // until the scope of the Env API is clarified (test only or runtime?)
  const bearer = iife(() => {
    const token = process.env.AWS_BEARER_TOKEN_BEDROCK
    if (token) return token
    if (auth?.type === "api") {
      process.env.AWS_BEARER_TOKEN_BEDROCK = auth.key
      return auth.key
    }
    return undefined
  })

  const identity = Env.get("AWS_WEB_IDENTITY_TOKEN_FILE")

  const container = Boolean(
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI,
  )

  if (!profile && !accessKey && !bearer && !identity && !container) return { autoload: false }

  const opts: AmazonBedrockProviderSettings = { region }

  // Only use credential chain if no bearer token exists
  // Bearer token takes precedence over credential chain (profiles, access keys, IAM roles, web identity tokens)
  if (!bearer) {
    opts.credentialProvider = fromNodeProviderChain(profile ? { profile } : {})
  }

  // Add custom endpoint if specified (endpoint takes precedence over baseURL)
  const endpoint = cfg?.options?.endpoint ?? cfg?.options?.baseURL
  if (endpoint) opts.baseURL = endpoint

  return {
    autoload: true,
    options: opts,
    async getModel(sdk: SDK, modelID: string, options?: Record<string, unknown>) {
      // Skip region prefixing if model already has a cross-region inference profile prefix
      const prefixes = ["global.", "us.", "eu.", "jp.", "apac.", "au."]
      if (prefixes.some((p) => modelID.startsWith(p))) {
        return sdk.languageModel(modelID)
      }

      // Region resolution precedence (highest to lowest):
      // 1. options.region from liteai.json provider config
      // 2. defaultRegion from AWS_REGION environment variable
      // 3. Default "us-east-1" (baked into region)
      const r = options?.region ?? region
      let prefix = r.split("-")[0]

      switch (prefix) {
        case "us": {
          const needs = ["nova-micro", "nova-lite", "nova-pro", "nova-premier", "nova-2", "claude", "deepseek"].some(
            (m) => modelID.includes(m),
          )
          if (needs && !r.startsWith("us-gov")) {
            modelID = `${prefix}.${modelID}`
          }
          break
        }
        case "eu": {
          const regionNeeds = [
            "eu-west-1",
            "eu-west-2",
            "eu-west-3",
            "eu-north-1",
            "eu-central-1",
            "eu-south-1",
            "eu-south-2",
          ].some((x) => r.includes(x))
          const modelNeeds = ["claude", "nova-lite", "nova-micro", "llama3", "pixtral"].some((m) => modelID.includes(m))
          if (regionNeeds && modelNeeds) {
            modelID = `${prefix}.${modelID}`
          }
          break
        }
        case "ap": {
          const isAustralia = ["ap-southeast-2", "ap-southeast-4"].includes(r)
          const isTokyo = r === "ap-northeast-1"
          if (
            isAustralia &&
            ["anthropic.claude-sonnet-4-5", "anthropic.claude-haiku"].some((m) => modelID.includes(m))
          ) {
            prefix = "au"
            modelID = `${prefix}.${modelID}`
          } else if (isTokyo) {
            const needs = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) => modelID.includes(m))
            if (needs) {
              prefix = "jp"
              modelID = `${prefix}.${modelID}`
            }
          } else {
            const needs = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) => modelID.includes(m))
            if (needs) {
              prefix = "apac"
              modelID = `${prefix}.${modelID}`
            }
          }
          break
        }
      }

      return sdk.languageModel(modelID)
    },
  }
}
