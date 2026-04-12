import type { TranscriptMessage } from "../session/transcript"

export async function classifyYoloAction(transcript: TranscriptMessage[]): Promise<boolean> {
  // safety classifier logic ported from liteai2
  const yoloPatterns = [/rm\s+-rf/i, /drop\s+table/i, /delete\s+from/i, /chmod\s+-R\s+777/i, /git\s+push\s+--force/i]

  for (const msg of transcript) {
    if (msg.role === "assistant" && typeof msg.content === "string") {
      for (const pattern of yoloPatterns) {
        if (pattern.test(msg.content)) return true
      }
    }
  }
  return false
}
