import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@/util/log"

const logger = Log.create({ service: "sidechain-transcript" })

export interface TranscriptMessage {
  isSidechain: true
  uuid: string
  parentUuid?: string
  role: string
  content: string | Record<string, unknown> | unknown[]
  timestamp: number
}

export namespace SidechainTranscript {
  export interface SidechainTranscriptInstance {
    getPath(): string
    recordMessage(message: TranscriptMessage): Promise<void>
    recordChain(messages: TranscriptMessage[]): Promise<void>
  }

  export async function read(
    dir: string,
    sessionId: string,
    subdir: string,
    agentId: string,
  ): Promise<TranscriptMessage[]> {
    const transcriptPath = getPath(dir, sessionId, subdir, agentId)
    try {
      const content = await fs.readFile(transcriptPath, "utf-8")
      const lines = content.split("\n").filter((l) => l.trim().length > 0)
      const messages: TranscriptMessage[] = []
      for (let i = 0; i < lines.length; i++) {
        try {
          messages.push(JSON.parse(lines[i]) as TranscriptMessage)
        } catch {
          logger.warn("Skipping malformed transcript line", {
            sessionId,
            agentId,
            lineIndex: i,
            line: lines[i].slice(0, 200),
          })
        }
      }
      return messages
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT") return []
      throw err
    }
  }

  export function extractContentReplacementState(_messages: TranscriptMessage[]): Record<string, unknown> {
    // Basic extraction placeholder. Optimization state reconstruction is further defined
    // in T016 by scanning resumed messages for persisted content references.
    const state: Record<string, unknown> = {}
    return state
  }

  export function getPath(dir: string, sessionId: string, subdir: string, agentId: string): string {
    return path.join(dir, sessionId, "subagents", subdir, `agent-${agentId}.jsonl`)
  }

  export function create(dir: string, sessionId: string, subdir: string, agentId: string): SidechainTranscriptInstance {
    const transcriptPath = getPath(dir, sessionId, subdir, agentId)

    const ensureDirectory = async () => {
      await fs.mkdir(path.dirname(transcriptPath), { recursive: true })
    }

    return {
      getPath() {
        return transcriptPath
      },
      async recordMessage(message: TranscriptMessage) {
        try {
          await ensureDirectory()
          const line = `${JSON.stringify(message)}\n`
          await fs.appendFile(transcriptPath, line, "utf-8")
        } catch (err) {
          logger.error("Failed to record sidechain message", { error: err, agentId, transcriptPath })
        }
      },
      async recordChain(messages: TranscriptMessage[]) {
        try {
          await ensureDirectory()
          const lines = `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`
          await fs.appendFile(transcriptPath, lines, "utf-8")
        } catch (err) {
          logger.error("Failed to record sidechain chain", { error: err, agentId, transcriptPath })
        }
      },
    }
  }
}
