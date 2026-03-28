#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./packages/sdk/script/build.ts`

await $`bun biome format --write packages/sdk/src/gen`
