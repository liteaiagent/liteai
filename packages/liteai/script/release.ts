#!/usr/bin/env bun
import fs from "node:fs"
import path from "node:path"
/**
 * Release orchestrator for liteai.
 *
 * Usage:
 *   bun run script/release.ts [--preview] [--bump patch|minor|major]
 *
 * Flags:
 *   --preview        Use branch-based preview channel instead of stable latest
 *   --bump <type>    Version bump type: patch (default), minor, major
 */
import { $ } from "bun"

const args = process.argv.slice(2)
const preview = args.includes("--preview")
const bumpIdx = args.indexOf("--bump")
const bump = args.find((a) => a.startsWith("--bump="))?.split("=")[1] ?? (bumpIdx !== -1 ? args[bumpIdx + 1] : "patch")

// Set env vars on process.env so both child processes (build.ts) and
// in-process imports (script.ts) see the same values.
if (!preview) {
  process.env.LITEAI_CHANNEL ??= "latest"
  process.env.LITEAI_BUMP ??= bump
}
process.env.GH_REPO ??= "liteaiagent/liteai"

const { Script } = await import("./script")
const dir = path.resolve(import.meta.dir, "..")

// ── Build ───────────────────────────────────────────────────
const hasBuild =
  fs.existsSync(path.resolve(dir, "dist")) &&
  fs.readdirSync(path.resolve(dir, "dist")).some((f) => !f.endsWith(".zip") && !f.endsWith(".tar.gz"))

if (!hasBuild) {
  console.log(`\n▶ Building liteai v${Script.version} (channel: ${Script.channel})`)
  await $`bun run script/build.ts`
} else {
  console.log(`\n▶ Found existing build outputs, skipping build`)
}

// ── Archive ─────────────────────────────────────────────────
const hasArchives =
  fs.existsSync(path.resolve(dir, "dist")) &&
  fs.readdirSync(path.resolve(dir, "dist")).some((f) => f.endsWith(".zip") || f.endsWith(".tar.gz"))

if (!hasArchives) {
  console.log("\n▶ Archiving")
  const dirs = fs.readdirSync(path.resolve(dir, "dist")).filter((f) => {
    const full = path.resolve(dir, "dist", f)
    return fs.statSync(full).isDirectory()
  })

  for (const key of dirs) {
    const src = path.resolve(dir, `dist/${key}/bin`)
    if (!fs.existsSync(src)) continue
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(src)
    } else if (process.platform === "win32") {
      const dest = path.resolve(dir, `dist/${key}.zip`)
      await $`powershell -Command "Compress-Archive -Path '${src}/*' -DestinationPath '${dest}' -Force"`
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(src)
    }
  }
  console.log(`Archived ${dirs.length} targets`)
} else {
  console.log("\n▶ Found existing archives, skipping archiving")
}

// ── GitHub Release ───────────────────────────────────────
console.log("\n▶ Uploading to GitHub Releases")
const repo = process.env.GH_REPO as string
const tag = `v${Script.version}`

const files = fs.readdirSync(path.resolve(dir, "dist")).filter((f) => f.endsWith(".zip") || f.endsWith(".tar.gz"))
if (files.length === 0) {
  console.error("Error: no archives found in dist/ — archive step failed")
  process.exit(1)
}

import crypto from "node:crypto"

console.log("\n▶ Generating checksums")
const checksumLines = files.map((file) => {
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.resolve(dir, "dist", file)))
    .digest("hex")
  return `${hash}  ${file}`
})
fs.writeFileSync(path.resolve(dir, "dist", "checksums.txt"), `${checksumLines.join("\n")}\n`)
files.push("checksums.txt")

const assets = files.map((f) => `./dist/${f}`)
assets.push(path.resolve(dir, "../../install"))
assets.push(path.resolve(dir, "../../install.ps1"))

const exists = await $`gh release view ${tag} --repo ${repo} --json assets`.nothrow().quiet()
let existingAssets: string[] = []

if (exists.exitCode !== 0) {
  console.log(`Creating release ${tag}`)
  const pre = Script.preview ? "--prerelease" : ""
  await $`gh release create ${tag} --repo ${repo} --title ${tag} --generate-notes ${pre}`
} else {
  try {
    const data = JSON.parse(exists.stdout.toString())
    if (data.assets) {
      existingAssets = data.assets.map((a: { name: string }) => a.name)
    }
  } catch (_e) {
    // Ignore error
  }
}

const remainingAssets = assets.filter((a) => !existingAssets.includes(path.basename(a)))

if (remainingAssets.length === 0) {
  console.log(`All ${assets.length} assets are already uploaded to ${tag}`)
} else {
  if (existingAssets.length > 0) {
    console.log(
      `Uploading ${remainingAssets.length} remaining assets to ${tag} (skipping ${assets.length - remainingAssets.length} already uploaded)`,
    )
  }
  await $`gh release upload ${tag} ${remainingAssets} --clobber --repo ${repo}`
  console.log(`Uploaded ${remainingAssets.length} assets to ${tag}`)
}

console.log("\n✓ Done")
