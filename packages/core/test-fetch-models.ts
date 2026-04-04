/**
 * Quick test: verify that Code Assist and AI4ALL loaders
 * can fetch model lists from their respective API endpoints.
 *
 * Run: bun run test-fetch-models.ts
 */
import { globalState } from "./src/provider/state"

async function main() {
  console.log("Resolving providers (this triggers model fetching)...\n")

  const result = await globalState()

  // Check Code Assist
  const ca = result.providers["google-code-assist"]
  if (ca) {
    const models = Object.keys(ca.models)
    console.log(`✅ Google Code Assist: ${models.length} models`)
    for (const m of models) console.log(`   - ${m}`)
  } else {
    console.log("⚠️  Google Code Assist: not resolved (no auth?)")
  }

  console.log()

  // Check AI4ALL
  const ai = result.providers.ai4all
  if (ai) {
    const models = Object.keys(ai.models)
    console.log(`✅ AI4ALL: ${models.length} models`)
    for (const m of models) console.log(`   - ${m}`)
  } else {
    console.log("⚠️  AI4ALL: not resolved (no auth?)")
  }
}

main().catch(console.error)
