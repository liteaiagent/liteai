import path from "node:path"
import type { PlatformProfile } from "../profile"

export const gemini: PlatformProfile = {
  id: "gemini",
  name: "Gemini CLI",
  dirs: [".gemini"],
  instructionFiles: ["GEMINI.md"],
  globalInstructionPaths: (home) => [path.join(home, ".gemini", "GEMINI.md")],
  mcpJson: false,
  schemaCompat: false,
}
