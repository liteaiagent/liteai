import { createLiteaiClient } from "@liteai/sdk/client"
import type { ServerConnection } from "./server"

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createLiteaiClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${btoa(`${server.username ?? "liteai"}:${server.password}`)}`,
    }
  })()

  return createLiteaiClient({
    client: "web",
    ...config,
    headers: { ...config.headers, ...auth },
    baseUrl: server.url,
  })
}
