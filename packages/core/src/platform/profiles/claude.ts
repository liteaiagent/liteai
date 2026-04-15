import path from "node:path"
import type { Config } from "@/config/config"
import { PermissionNext } from "@/permission/next"
import type { PlatformProfile } from "../profile"

/**
 * Map Claude Code agent frontmatter fields (tools / disallowedTools / permissionMode)
 * to LiteAI permission rules.
 */
function permissionTransform(value: Config.Agent): PermissionNext.Ruleset | undefined {
  const rules: Config.Permission = {}
  let any = false

  // permissionMode presets
  if (value.permissionMode === "dontAsk" || value.permissionMode === "bypassPermissions") {
    rules["*"] = "allow"
    any = true
  } else if (value.permissionMode === "plan") {
    Object.assign(rules, { "*": "deny", read: "allow", grep: "allow", glob: "allow", list: "allow" })
    any = true
  } else if (value.permissionMode === "acceptEdits") {
    Object.assign(rules, { edit: "allow", write: "allow" })
    any = true
  }

  // tools: allowed tool list (implies *:deny base)
  if (value.tools) {
    const list =
      typeof value.tools === "string"
        ? value.tools.split(",").map((t) => t.trim().toLowerCase())
        : Array.isArray(value.tools)
          ? value.tools.map((t) => t.toLowerCase())
          : Object.entries(value.tools)
              .filter(([, v]) => v)
              .map(([k]) => k.toLowerCase())
    if (list.length) {
      rules["*"] = "deny"
      for (const t of list) rules[t] = "allow"
      any = true
    }
  }

  // disallowedTools: denied tool list
  if (value.disallowedTools) {
    const list =
      typeof value.disallowedTools === "string"
        ? value.disallowedTools.split(",").map((t) => t.trim().toLowerCase())
        : value.disallowedTools.map((t) => t.toLowerCase())
    for (const t of list) rules[t] = "deny"
    if (list.length) any = true
  }

  if (!any) return undefined
  return PermissionNext.fromConfig(rules)
}

export const claude: PlatformProfile = {
  id: "claude",
  name: "Claude Code",
  dirs: [".claude"],
  instructionFiles: ["CLAUDE.md"],
  globalInstructionPaths: (home) => [path.join(home, ".claude", "CLAUDE.md")],
  mcpJson: true,
  schemaCompat: true,
  permissionTransform,
  toolNameMap: {
    Edit: "edit",
    Write: "write",
    Read: "read",
    Glob: "glob",
    Grep: "grep",
    List: "list",
    NotebookEdit: "multiedit",
    Agent: "task",
    ExitPlanMode: "plan_exit",
    Bash: "run_command",
  },
}
