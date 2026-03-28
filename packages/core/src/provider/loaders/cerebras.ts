import type { LoaderResult } from "./types"

export async function cerebras(): Promise<LoaderResult> {
  return {
    autoload: false,
    options: {
      headers: {
        "X-Cerebras-3rd-Party-Integration": "liteai",
      },
    },
  }
}
