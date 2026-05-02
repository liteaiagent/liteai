import { useEffect, useState } from "react"
import { useSDK } from "../context/sdk"

export type MemoryFile = {
  path: string
  name: string
  isDirectory: boolean
}

export function useMemoryFiles() {
  const sdk = useSDK()
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function fetchFiles() {
      try {
        setLoading(true)
        const allFiles: MemoryFile[] = []

        // Fetch project root for AGENTS.md
        const rootResult = await sdk.client.project.file.list({ projectID: sdk.projectID, path: "." })
        if (rootResult.data) {
          const agentsFile = rootResult.data.find((f: { name: string }) => f.name.toLowerCase() === "agents.md")
          if (agentsFile && active) {
            allFiles.push({
              path: agentsFile.path,
              name: agentsFile.name,
              isDirectory: false,
            })
          }
        }

        // Fetch .liteai/memory
        const memoryResult = await sdk.client.project.file.list({ projectID: sdk.projectID, path: ".liteai/memory" })
        if (memoryResult.data && active) {
          for (const rawFile of memoryResult.data) {
            const f = rawFile as { name: string; path: string }
            if (f.name.endsWith(".md")) {
              allFiles.push({
                path: f.path,
                name: `.liteai/memory/${f.name}`,
                isDirectory: false,
              })
            }
          }
        }

        if (active) {
          setFiles(allFiles)
        }
      } catch (err: unknown) {
        // 404/not-found is expected when no memory directory exists.
        // Surface all other errors so they're visible during UAT.
        const status = (err as { status?: number })?.status
        if (status !== 404 && status !== undefined) {
          console.warn("[use-memory-files] Unexpected error discovering memory files:", err)
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void fetchFiles()

    return () => {
      active = false
    }
  }, [sdk])

  return { files, loading }
}
