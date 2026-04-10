import fs from "node:fs/promises"
import path from "node:path"

/**
 * Unified loader for all bundled assets (agents, skills, commands, prompts).
 *
 * All reads go through `import.meta.dir`-relative paths. Bun's `--compile`
 * embeds files discovered through `import.meta.dir` into the single-file
 * executable, so this module works identically in both dev and compiled mode.
 */

const ROOT = import.meta.dir

export namespace Bundled {
  // ----- Agents -----

  /** Directory containing all bundled agent .md files. */
  export function agentsDir() {
    return path.join(ROOT, "agents")
  }

  /** Read a single agent .md file as raw string. */
  export async function agent(name: string): Promise<string> {
    return fs.readFile(path.join(ROOT, "agents", `${name}.md`), "utf-8")
  }

  // ----- Skills -----

  /** Directory containing all bundled skill subdirectories. */
  export function skillsDir() {
    return path.join(ROOT, "skills")
  }

  // ----- Commands -----

  /** Directory containing all bundled command template .md files. */
  export function commandsDir() {
    return path.join(ROOT, "commands")
  }

  /** Read a single command template .md file as raw string. */
  export async function command(name: string): Promise<string> {
    return fs.readFile(path.join(ROOT, "commands", `${name}.md`), "utf-8")
  }

  // ----- Prompts -----

  /** Read the unified system prompt .md file. */
  export async function systemMd(): Promise<string> {
    return fs.readFile(path.join(ROOT, "prompts", "system", "system.md"), "utf-8")
  }

  /** Read a misc prompt .md file (e.g. "build-switch", "max-steps"). */
  export async function miscPrompt(name: string): Promise<string> {
    return fs.readFile(path.join(ROOT, "prompts", "misc", `${name}.md`), "utf-8")
  }

  /** Read an agent-scoped prompt .md file (e.g. "generate"). */
  export async function agentPrompt(name: string): Promise<string> {
    return fs.readFile(path.join(ROOT, "prompts", "agents", `${name}.md`), "utf-8")
  }
}
