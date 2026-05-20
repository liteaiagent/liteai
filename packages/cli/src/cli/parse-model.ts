/**
 * Splits a "provider/model" string into its component parts.
 *
 * Replaces `Provider.parseModel()` from `@liteai/core/provider/provider`
 * which was a 4-line string split that pulled in the entire Provider namespace.
 * The SDK accepts plain strings for providerID/modelID — no branded types needed
 * at the CLI boundary.
 */
export function parseModel(model: string): { providerID: string; modelID: string } {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID,
    modelID: rest.join("/"),
  }
}
