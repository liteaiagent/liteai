#!/usr/bin/env bun
import { fileURLToPath } from "node:url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import path from "node:path"
import { createClient } from "@hey-api/openapi-ts"
import { $ } from "bun"

const spec = await $`bun run --conditions=browser script/generate-openapi.ts`.cwd(path.resolve(dir, "../core")).text()
const openapi = path.resolve(dir, "openapi.json")
await Bun.write(openapi, spec)

await createClient({
  input: openapi,
  output: {
    path: "./src/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      operations: {
        strategy: "single",
        containerName: "LiteaiClient",
        methods: "instance",
      },
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:9000",
    },
  ],
})

await $`bun biome format --write src/gen openapi.json`
await $`rm -rf dist`
await $`bun tsc`
