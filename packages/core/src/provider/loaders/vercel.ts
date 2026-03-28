import type { LoaderResult } from "./types"

export async function vercel(): Promise<LoaderResult> {
  return {
    autoload: false,
    options: {
      headers: {
        "http-referer": "https://liteai.com/",
        "x-title": "liteai",
      },
    },
  }
}
