import type { LoaderResult } from "./types"

export async function zenmux(): Promise<LoaderResult> {
  return {
    autoload: false,
    options: {
      headers: {
        "HTTP-Referer": "https://liteai.com/",
        "X-Title": "liteai",
      },
    },
  }
}
