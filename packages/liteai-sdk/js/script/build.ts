#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const spec = await $`bun run --conditions=browser ./src/index.ts generate`.cwd(path.resolve(dir, "../../liteai")).text()
const openapi = path.resolve(dir, "../openapi.json")
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
      instance: "LiteaiClient",
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

await $`bun biome format --write src/gen`
await $`rm -rf dist`
await $`bun tsc`
