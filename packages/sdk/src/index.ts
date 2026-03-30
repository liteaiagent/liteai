export * from "./client.js"
export * from "./server.js"

import { createLiteaiClient } from "./client.js"
import type { ServerOptions } from "./server.js"
import { createLiteaiServer } from "./server.js"

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
