import * as fs from "node:fs"
import * as path from "node:path"

const inputFile = process.argv[2]
if (!inputFile) {
  console.error("Usage: bun script/trace_extract.ts <trace.json>")
  process.exit(1)
}

const inputPath = path.resolve(inputFile)
if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`)
  process.exit(1)
}

try {
  const content = fs.readFileSync(inputPath, "utf8").trim()

  interface TraceNode {
    type?: string
    input?: unknown
    output?: unknown
    metadata?: {
      tools?: unknown[]
      attributes?: Record<string, unknown>
      [key: string]: unknown
    }
    [key: string]: unknown
  }

  let lastGeneration: TraceNode | null = null

  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        console.warn("Trace file contains an empty array.")
        process.exit(0)
      }

      // Find the last item with type GENERATION
      for (let i = parsed.length - 1; i >= 0; i--) {
        if (parsed[i] && parsed[i].type === "GENERATION") {
          lastGeneration = parsed[i]
          break
        }
      }

      // Fallback if no GENERATION found
      if (!lastGeneration) {
        console.warn("No GENERATION found. Taking the last element as fallback.")
        lastGeneration = parsed[parsed.length - 1]
      }
    } else {
      lastGeneration = parsed
    }
  } catch (parseErr) {
    // Attempt parsing as JSONL (JSON Lines)
    const lines = content.split("\n").filter((line) => line.trim().length > 0)
    if (lines.length > 0) {
      try {
        for (let i = lines.length - 1; i >= 0; i--) {
          const parsedLine = JSON.parse(lines[i] as string)
          if (parsedLine && parsedLine.type === "GENERATION") {
            lastGeneration = parsedLine
            break
          }
        }

        if (!lastGeneration) {
          console.warn("No GENERATION found in JSONL. Taking the last line as fallback.")
          lastGeneration = JSON.parse(lines[lines.length - 1] as string)
        }
      } catch (_jsonlErr) {
        throw new Error(
          `Failed to parse file as either JSON array or JSONL. JSON Error: ${String(parseErr instanceof Error ? parseErr.message : parseErr)}`,
        )
      }
    } else {
      throw parseErr
    }
  }

  const ext = path.extname(inputFile)
  const baseName = path.basename(inputFile, ext)
  const dirName = path.dirname(inputFile)

  const outputFile = path.join(dirName, `${baseName}_ex${ext || ".json"}`)

  if (lastGeneration) {
    for (const key of ["input", "output", "metadata"]) {
      if (typeof lastGeneration[key] === "string") {
        try {
          lastGeneration[key] = JSON.parse(lastGeneration[key] as string)
        } catch (_) {}
      }
    }

    if (lastGeneration.metadata && Array.isArray(lastGeneration.metadata.tools)) {
      lastGeneration.metadata.tools = lastGeneration.metadata.tools.map((tool: unknown) => {
        if (typeof tool === "string") {
          try {
            return JSON.parse(tool)
          } catch (_) {}
        }
        return tool
      })
    }

    if (
      lastGeneration.metadata?.attributes &&
      typeof lastGeneration.metadata.attributes["ai.prompt.tools"] === "string"
    ) {
      try {
        const parsedTools = JSON.parse(lastGeneration.metadata.attributes["ai.prompt.tools"] as string)
        if (Array.isArray(parsedTools)) {
          lastGeneration.metadata.attributes["ai.prompt.tools"] = parsedTools.map((tool: unknown) => {
            if (typeof tool === "string") {
              try {
                return JSON.parse(tool)
              } catch (_) {}
            }
            return tool
          })
        } else {
          lastGeneration.metadata.attributes["ai.prompt.tools"] = parsedTools
        }
      } catch (_) {}
    }
  }

  fs.writeFileSync(outputFile, JSON.stringify(lastGeneration, null, 2), "utf8")
  console.log(`Successfully extracted last generation to ${outputFile}`)
} catch (e) {
  console.error("Error processing trace file:", e)
  process.exit(1)
}
