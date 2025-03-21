#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./packages/liteai-sdk/js/script/build.ts`

await $`bun biome format --write packages/liteai-sdk/js/src/gen`
