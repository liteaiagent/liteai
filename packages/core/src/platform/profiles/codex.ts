import path from "node:path"
import type { PlatformProfile } from "../profile"

export const codex: PlatformProfile = {
  id: "codex",
  name: "Codex",
  dirs: [".codex"],
  instructionFiles: ["CODEX.md"],
  globalInstructionPaths: (home) => [path.join(home, ".codex", "CODEX.md")],
  mcpJson: false,
  schemaCompat: false,
}
