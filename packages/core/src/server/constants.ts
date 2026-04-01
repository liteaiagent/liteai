/**
 * Server constants — extracted from scattered magic values throughout the server module.
 */

/** SSE heartbeat interval in milliseconds. */
export const HEARTBEAT_INTERVAL_MS = 10_000

/** Vite dev server URL used in local/dev mode for static asset proxying. */
export const DEV_SERVER_URL = "http://localhost:3000"

/** Shared OpenAPI document metadata. */
export const API_INFO = {
  title: "liteai",
  version: "1.0.0",
  description: "liteai api",
} as const
