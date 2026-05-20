/**
 * Splits a "provider/model" string into its component parts.
 *
 * Replaces `Provider.parseModel()` from `@liteai/core/provider/provider`
 * which was a 4-line string split that pulled in the entire Provider namespace.
 * The SDK accepts plain strings for providerID/modelID — no branded types needed
 * at the CLI boundary.
 */
export function parseModel(model: string): { providerID: string; modelID: string } {
  if (!model || !model.includes("/")) {
    throw new Error(`Invalid model format: expected "provider/model", got "${model}"`)
  }
  const [providerID, ...rest] = model.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) {
    throw new Error(`Invalid model format: expected "provider/model", got "${model}"`)
  }
  return { providerID, modelID }
}
