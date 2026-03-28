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
  log.info("initializing auth providers", {
    providers: [...AUTH_PROVIDERS.keys()],
  })
  const results = await Promise.allSettled(
    [...AUTH_PROVIDERS.entries()].map(async ([id, p]) => {
      if (!p.setup) {
        log.info("auth provider has no setup, skipping", { provider: id })
        return
      }
      log.info("running auth provider setup", { provider: id })
      await p.setup()
      log.info("auth provider setup complete", { provider: id })
    }),
  )
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const id = [...AUTH_PROVIDERS.keys()][i]
    if (result.status === "rejected") {
      log.error("auth provider setup failed", {
        provider: id,
        error: result.reason,
      })
    }
  }
  log.info("auth providers initialized")
}
