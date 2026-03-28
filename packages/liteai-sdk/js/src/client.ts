export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { LiteaiClient } from "./gen/sdk.gen.js"
export { type Config as LiteaiClientConfig, LiteaiClient }

export function createLiteaiClient(config?: Config & { experimental_workspaceID?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
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

  const client = createClient(config)
  return new LiteaiClient({ client })
}
