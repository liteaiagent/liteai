#!/usr/bin/env bun
/**
 * Build script for @liteai/core executable.
 * Compiles the core server into a single-file Bun executable for the current platform.
 *
 * Usage:
 *   bun run build              # build for current platform
 *   bun run build --all        # build for all platforms
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import solidPlugin from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import pkg from "../package.json"

// ── Raw import plugin ──────────────────────────────────────
const rawPlugin: import("bun").BunPlugin = {
  name: "raw-plugin",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => {
      return {
        path: path.isAbsolute(args.path)
          ? args.path.replace(/\?raw$/, "")
          : path.join(path.dirname(args.importer), args.path.replace(/\?raw$/, "")),
        namespace: "raw",
      }
    })
    build.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => {
      return {
        contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};`,
        loader: "js",
      }
    })
  },
}

// ── Load migrations ────────────────────────────────────────
const migrationDir = path.join(dir, "migration")
const migrationDirs = (
  await fs.promises.readdir(migrationDir, { withFileTypes: true })
)
  .filter(
    (entry) =>
      entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name),
  )
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(migrationDir, name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

// ── Resolve version ────────────────────────────────────────
const version = process.env.LITEAI_VERSION || pkg.version || "0.0.0"
const channel = process.env.LITEAI_CHANNEL || "local"

// ── Target platforms ───────────────────────────────────────
const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", avx2: false },
  { os: "linux", arch: "arm64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl", avx2: false },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "darwin", arch: "x64", avx2: false },
  { os: "win32", arch: "arm64" },
  { os: "win32", arch: "x64" },
  { os: "win32", arch: "x64", avx2: false },
]

const buildAll = process.argv.includes("--all")

const targets = buildAll
  ? allTargets
  : allTargets.filter(
      (item) =>
        item.os === process.platform &&
        item.arch === process.arch &&
        item.avx2 !== false &&
        item.abi === undefined,
    )

if (targets.length === 0) {
  console.error(
    `No matching target for ${process.platform}-${process.arch}. Use --all to build all platforms.`,
  )
  process.exit(1)
}

function targetName(item: (typeof targets)[number]) {
  return [
    "liteai-core",
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi,
  ]
    .filter(Boolean)
    .join("-")
}

// ── Build ──────────────────────────────────────────────────
console.log(`\n▶ Building @liteai/core exe (v${version}, channel=${channel})`)
await Bun.$`rm -rf dist`

for (const item of targets) {
  const name = targetName(item)
  console.log(`  building ${name}`)
  await Bun.$`mkdir -p dist/${name}/bin`

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [solidPlugin, rawPlugin],
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      // biome-ignore lint/suspicious/noExplicitAny: Bun compile target is dynamically constructed
      target: name.replace("liteai-core", "bun") as any,
      outfile: `dist/${name}/bin/liteai-core`,
      execArgv: ["--use-system-ca", "--"],
      windows: {
        title: "LiteAI Core",
        publisher: "LiteAI",
        version: version.split("-")[0],
        description: "LiteAI Core Server",
        copyright: "Copyright (c)",
      },
    },
    entrypoints: ["./src/main.ts"],
    define: {
      LITEAI_VERSION: `'${version}'`,
      LITEAI_MIGRATIONS: JSON.stringify(migrations),
      LITEAI_CHANNEL: `'${channel}'`,
      LITEAI_LIBC:
        item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "undefined",
    },
  })

  console.log(`  ✓ ${name}`)
}

console.log("\n✓ Build complete")
