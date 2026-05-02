export const COMPACT_TOOL_ALLOWLIST: ReadonlySet<string> = new Set([
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

export function isCompactEligible(toolName: string): boolean {
  return COMPACT_TOOL_ALLOWLIST.has(toolName)
}
