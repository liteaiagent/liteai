import * as fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { $ } from "bun"

// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

function exists(dir: string) {
  return fs
    .stat(dir)
    .then(() => true)
    .catch(() => false)
}

function clean(dir: string) {
  return fs.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}

async function stop(dir: string) {
  if (!(await exists(dir))) return
  await $`git fsmonitor--daemon stop`.cwd(dir).quiet().nothrow()
}

type TmpDirOptions = {
  git?: boolean
}

export async function tmpdir(options?: TmpDirOptions) {
  const dirpath = sanitizePath(path.join(os.tmpdir(), `liteai-test-${Math.random().toString(36).slice(2)}`))
  await fs.mkdir(dirpath, { recursive: true })
  if (options?.git) {
    await $`git init`.cwd(dirpath).quiet()
    await $`git config core.fsmonitor false`.cwd(dirpath).quiet()
    await $`git config user.email "test@liteai.test"`.cwd(dirpath).quiet()
    await $`git config user.name "Test"`.cwd(dirpath).quiet()
    await $`git commit --allow-empty -m "root commit ${dirpath}"`.cwd(dirpath).quiet()
  }
  const realpath = sanitizePath(await fs.realpath(dirpath))
  const { Project } = await import("liteai/project/project")
  await Project.fromDirectory(realpath)
  return {
    [Symbol.asyncDispose]: async () => {
      if (options?.git) await stop(realpath).catch(() => undefined)
      await clean(realpath).catch(() => undefined)
    },
    path: realpath,
  }
}
