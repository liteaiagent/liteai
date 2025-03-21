import type { LoaderResult } from "./types"

export async function anthropic(): Promise<LoaderResult> {
  return {
    autoload: false,
    options: {
      headers: {
        "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
      },
    },
  }
}
