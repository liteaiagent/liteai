#!/usr/bin/env bun

import path from "node:path"
import { $ } from "bun"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

console.log("▶ Building liteai-core exes...")
await $`bun run build:exe`

console.log("▶ Copying exes into bin/...")
await $`node script/copy-exe.mjs`

console.log("▶ Compiling webview...")
await $`bun run compile-webview`

console.log("▶ Typechecking...")
await $`bun run typecheck`

console.log("▶ Linting...")
await $`bun run lint`

console.log("▶ Building extension host...")
await $`node esbuild.js --production`

console.log("▶ Generating VSIX package...")
await $`bunx @vscode/vsce package`

console.log("✅ Successfully built and packaged VS Code Extension!")
