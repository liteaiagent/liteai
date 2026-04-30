export * from "./client"
export * from "./server"

import { createLiteaiClient } from "./client"
import type { ServerOptions } from "./server"
import { createLiteaiServer } from "./server"

export async function createLiteai(options?: ServerOptions) {
  const server = await createLiteaiServer({
    ...options,
  })

  const client = createLiteaiClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
