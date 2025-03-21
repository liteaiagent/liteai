import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

await $`bun ./scripts/copy-icons.ts ${process.env.LITEAI_CHANNEL ?? "dev"}`

const RUST_TARGET = Bun.env.RUST_TARGET

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../liteai/dist/${sidecarConfig.ocBinary}/bin/liteai`)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../liteai && bun run build --single --baseline`
  : $`cd ../liteai && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
