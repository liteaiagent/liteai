import type { Project } from "@liteai/sdk/client"

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

  throw new Error(`Project not found in registry for directory: ${directory}`)
}

/** Map projectID -> directory path (reverse lookup) */
export function toDirectory(projectID: string): string | undefined {
  const match = projectRegistry.find((p) => p.id === projectID)
  return match?.worktree
}
