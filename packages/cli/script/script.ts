#!/usr/bin/env bun
import path from "node:path"
import { $ } from "bun"
import semver from "semver"

// Read bun version requirement from monorepo root
const rootPkg = await Bun.file(path.resolve(import.meta.dir, "../../../package.json")).json()
const expectedBun = rootPkg.packageManager?.split("@")[1]
if (expectedBun && !semver.satisfies(process.versions.bun, `^${expectedBun}`)) {
  console.warn(`Warning: script expects bun@^${expectedBun}, running bun@${process.versions.bun}`)
}

const env = {
  LITEAI_CHANNEL: process.env.LITEAI_CHANNEL,
  LITEAI_BUMP: process.env.LITEAI_BUMP,
  LITEAI_VERSION: process.env.LITEAI_VERSION,
  LITEAI_RELEASE: process.env.LITEAI_RELEASE,
}

const CHANNEL = await (async () => {
  if (env.LITEAI_CHANNEL) return env.LITEAI_CHANNEL
  if (env.LITEAI_BUMP) return "latest"
  if (env.LITEAI_VERSION && !env.LITEAI_VERSION.startsWith("0.0.0-")) return "latest"
  return $`git branch --show-current`.text().then((x) => x.trim())
})()

const preview = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.LITEAI_VERSION) return env.LITEAI_VERSION
  // Fetch latest stable release version from GitHub — default to 0.0.0 if none exist yet
  const repo = process.env.GH_REPO ?? "liteaiagent/liteai"
  const current = await $`gh release list --repo ${repo} --limit 50 --json tagName,isPrerelease`
    .json()
    .then(
      (list: { tagName: string; isPrerelease: boolean }[]) =>
        list.find((r) => !r.isPrerelease)?.tagName.replace(/^v/, "") ?? "0.0.0",
    )
    .catch(() => "0.0.0")
  const [major, minor, patch] = current.split(".").map((x: string) => Number(x) || 0)
  const bump = env.LITEAI_BUMP?.toLowerCase()
  const next =
    bump === "major"
      ? `${major + 1}.0.0`
      : bump === "minor"
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`
  if (preview) return `${next}-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  return next
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return preview
  },
  get release(): boolean {
    return !!env.LITEAI_RELEASE
  },
}

console.log("liteai script", JSON.stringify(Script, null, 2))
