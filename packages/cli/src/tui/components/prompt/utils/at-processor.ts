import type { Agent, LiteaiClient } from "@liteai/sdk"
import { parseAtReferences } from "./at-token"

export type ProcessedAtResult = {
  processedText: string // Original text with @refs preserved + reference content appended
  agentNudge: string | null // System nudge for agent @ references
  referencedFiles: string[] // List of files that were read (for UI feedback)
  errors: string[] // Files that couldn't be read
}

export async function processAtReferences(opts: {
  input: string
  agents: Agent[]
  sdk: LiteaiClient
  projectID: string
}): Promise<ProcessedAtResult> {
  const { input, agents, sdk, projectID } = opts
  const references = parseAtReferences(input)

  if (references.length === 0) {
    return { processedText: input, agentNudge: null, referencedFiles: [], errors: [] }
  }

  const agentNames = new Set(agents.map((a) => a.name))
  const agentRefs: string[] = []
  const fileRefs = []

  for (const ref of references) {
    if (agentNames.has(ref.path)) {
      agentRefs.push(ref.path)
    } else {
      fileRefs.push(ref)
    }
  }

  // Deduplicate file refs by path
  const uniqueFileRefs = new Map(fileRefs.map((r) => [r.path, r]))

  const fileReads = Array.from(uniqueFileRefs.values()).map(async (ref) => {
    try {
      const result = await sdk.project.file.read({ projectID, path: ref.path })
      return { ref, content: result.data, error: null }
    } catch (e) {
      return { ref, content: null, error: String(e) }
    }
  })

  const readResults = await Promise.all(fileReads)

  const successfulReads = readResults.filter((r) => !r.error && r.content !== null)
  const errors = readResults.filter((r) => r.error).map((r) => `Failed to read @${r.ref.path}: ${r.error}`)

  let processedText = input

  if (successfulReads.length > 0) {
    let referenceBlocks = "\n\n[Reference Content Start]"
    for (const read of successfulReads) {
      referenceBlocks += `\n\nContent from @${read.ref.path}:\n${read.content}`
    }
    referenceBlocks += "\n\n[Reference Content End]"
    processedText += referenceBlocks
  }

  let agentNudge: string | null = null
  if (agentRefs.length > 0) {
    const names = Array.from(new Set(agentRefs)).join(", ")
    agentNudge = `<system_note>\nThe user has explicitly selected the following agent(s): ${names}.\nPlease use the appropriate tools to delegate the task to them if necessary.\n</system_note>`
  }

  return {
    processedText,
    agentNudge,
    referencedFiles: successfulReads.map((r) => r.ref.path),
    errors,
  }
}
