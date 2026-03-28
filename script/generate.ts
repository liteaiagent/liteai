#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./packages/liteai-sdk/script/build.ts`

await $`bun biome format --write packages/liteai-sdk/src/gen`
