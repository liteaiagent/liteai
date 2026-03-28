#!/usr/bin/env bun
/**
 * Standalone OpenAPI spec generator.
 *
 * Outputs the enriched OpenAPI JSON to stdout so that consumers
 * (e.g. SDK build) can pipe it without depending on the full CLI.
 *
 * Usage:
 *   bun run --conditions=browser script/generate-openapi.ts
 */
import { Server } from "../src/server/server"

const specs: any = await Server.openapi()

// Enrich with code samples for each operation
for (const item of Object.values(specs.paths) as any[]) {
  for (const method of ["get", "post", "put", "delete", "patch"] as const) {
    const operation = item[method]
    if (!operation?.operationId) continue
    operation["x-codeSamples"] = [
      {
        lang: "js",
        source: [
          `import { createLiteaiClient } from "@liteai/sdk`,
          ``,
          `const client = createLiteaiClient()`,
          `await client.${operation.operationId}({`,
          `  ...`,
          `})`,
        ].join("\n"),
      },
    ]
  }
}

const json = JSON.stringify(specs, null, 2)

// Wait for stdout to finish writing before process exits
await new Promise<void>((resolve, reject) => {
  process.stdout.write(json, (err) => {
    if (err) reject(err)
    else resolve()
  })
})
