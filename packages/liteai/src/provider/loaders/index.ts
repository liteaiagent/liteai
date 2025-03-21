import type { CustomLoader } from "./types"

export { BUNDLED_PROVIDERS } from "./bundled"
export type { CustomLoader, LoaderInput, LoaderResult, ModelLoader, VarsLoader } from "./types"

import { ai4all } from "./ai4all"
import { amazonBedrock } from "./amazon-bedrock"
import { anthropic } from "./anthropic"
import { azure, azureCognitiveServices } from "./azure"
import { cerebras } from "./cerebras"
import { cloudflareAiGateway, cloudflareWorkersAi } from "./cloudflare"
import { githubCopilot, githubCopilotEnterprise } from "./github-copilot"
import { gitlab } from "./gitlab"
import { googleCodeAssist } from "./google-code-assist"
import { googleVertex, googleVertexAnthropic } from "./google-vertex"
import { kilo } from "./kilo"
import { openai } from "./openai"
import { opencode } from "./opencode"
import { openrouter } from "./openrouter"
import { sapAiCore } from "./sap-ai-core"
import { vercel } from "./vercel"
import { zenmux } from "./zenmux"

export const CUSTOM_LOADERS: Record<string, CustomLoader> = {
  anthropic,
  opencode,
  openai,
  "github-copilot": githubCopilot,
  "github-copilot-enterprise": githubCopilotEnterprise,
  azure,
  "azure-cognitive-services": azureCognitiveServices,
  "amazon-bedrock": amazonBedrock,
  openrouter,
  vercel,
  "google-vertex": googleVertex,
  "google-vertex-anthropic": googleVertexAnthropic,
  "sap-ai-core": sapAiCore,
  zenmux,
  gitlab,
  "cloudflare-workers-ai": cloudflareWorkersAi,
  "cloudflare-ai-gateway": cloudflareAiGateway,
  cerebras,
  kilo,
  "google-code-assist": googleCodeAssist,
  ai4all,
}
