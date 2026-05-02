/**
 * Compact-tool allowlist with static + dynamic membership.
 *
 * Static entries are hard-coded built-in tools that always render in compact
 * mode. Dynamic entries are registered at runtime — primarily by MCP servers
 * that declare `annotations.compactEligible: true` on their tool definitions.
 */

const STATIC_ALLOWLIST: ReadonlySet<string> = new Set([
  "read",
  "grep",
  "glob",
  "list",
  "codesearch",
  "websearch",
  "webfetch",
  "write",
  "edit",
  "apply_patch",
])

const dynamicAllowlist = new Set<string>()

export function registerCompactTool(toolName: string): void {
  dynamicAllowlist.add(toolName)
}

export function unregisterCompactTool(toolName: string): void {
  dynamicAllowlist.delete(toolName)
}

export function clearDynamicCompactTools(): void {
  dynamicAllowlist.clear()
}

export function isCompactEligible(toolName: string): boolean {
  return STATIC_ALLOWLIST.has(toolName) || dynamicAllowlist.has(toolName)
}
