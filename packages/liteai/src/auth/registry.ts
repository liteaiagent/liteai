import { Log } from "@/util/log"
import type { AuthProvider } from "./provider"
import { Ai4allAuth } from "./providers/ai4all"
import { CodeAssistAuth } from "./providers/code-assist"
import { CodexAuth } from "./providers/codex"
import { CopilotAuth } from "./providers/copilot"

const log = Log.create({ service: "auth.registry" })

export const AUTH_PROVIDERS = new Map<string, AuthProvider>([
  ["openai", CodexAuth],
  ["github-copilot", CopilotAuth],
  ["google-code-assist", CodeAssistAuth],
  ["ai4all", Ai4allAuth],
])

/** Called once during global server boot */
export async function initializeAuthProviders() {
  log.info("initializing auth providers")
  await Promise.allSettled([...AUTH_PROVIDERS.values()].map((p) => p.setup?.()))
  log.info("auth providers initialized")
}
