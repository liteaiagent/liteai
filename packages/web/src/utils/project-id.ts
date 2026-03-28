import type { Project } from "@liteai/sdk/client"
import { base64Encode } from "@liteai/util/encode"

let projectRegistry: Project[] = []

export function __updateProjectRegistry(projects: Project[]) {
  projectRegistry = projects
}

/** Map directory path -> projectID for SDK API calls */
export function toProjectID(directory: string): string {
  const match = projectRegistry.find(
    (p) =>
      p.worktree === directory ||
      (p as { sandbox?: string; directory?: string }).sandbox === directory ||
      (p as { sandbox?: string; directory?: string }).directory === directory,
  )
  if (match?.id) return match.id

  // Fallback
  return base64Encode(directory)
}
