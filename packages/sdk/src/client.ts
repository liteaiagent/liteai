export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import type { Config } from "./gen/client/types.gen.js"
import { LiteaiClient } from "./gen/sdk.gen.js"
export { type Config as LiteaiClientConfig, LiteaiClient }

export function createLiteaiClient(config?: Config & { experimental_workspaceID?: string; client?: string }) {
  if (!config?.fetch) {
    const customFetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const req = input as Request & { timeout?: boolean }
      req.timeout = false
      return fetch(input, init)
    }) as typeof fetch
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.experimental_workspaceID) {
    config.headers = {
      ...config.headers,
      "x-liteai-workspace": config.experimental_workspaceID,
    }
  }
  
  if (config?.client) {
    config.headers = {
      ...config.headers,
      "x-liteai-client": config.client,
    }
  }

  const client = createClient(config)
  return new LiteaiClient({ client })
}
