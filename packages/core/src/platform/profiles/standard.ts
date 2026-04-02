import path from "node:path"
import type { PlatformProfile } from "../profile"

export const standard: PlatformProfile = {
  id: "standard",
  name: "Standard",
  dirs: [".agents"],
  instructionFiles: ["AGENTS.md"],
  globalInstructionPaths: (home) => [path.join(home, ".agents", "AGENTS.md")],
  mcpJson: false,
  schemaCompat: false,
}
