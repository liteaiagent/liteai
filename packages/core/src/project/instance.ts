import { Effect } from "effect"
import { NotFoundError } from "@/storage/db"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"
import { iife } from "@/util/iife"
import { InstanceState } from "@/util/instance-state"
import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"

interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}
const context = Context.create<InstanceContext>("instance")
const cache = new Map<string, Promise<InstanceContext>>()

// Reboot loop detection: track dispose timestamps per directory
const MAX_REBOOTS = 3
const REBOOT_WINDOW = 60_000
const reboots = new Map<string, number[]>()
const halted = new Set<string>()

function trackReboot(directory: string): boolean {
  if (halted.has(directory)) return false
  const now = Date.now()
  const times = reboots.get(directory) ?? []
  times.push(now)
  // Keep only timestamps within the window
  const recent = times.filter((t) => now - t < REBOOT_WINDOW)
  reboots.set(directory, recent)
  if (recent.length >= MAX_REBOOTS) {
    halted.add(directory)
    Log.Default.error(
      `instance reboot loop detected — ${recent.length} reboots in ${Math.round((now - recent[0]) / 1000)}s, halting instance recreation`,
      { directory },
    )
    return false
  }
  return true
}

const disposal = {
  all: undefined as Promise<void> | undefined,
}

function emit(directory: string) {
  GlobalBus.emit("event", {
    directory,
    payload: {
      type: "server.instance.disposed",
      properties: {
        directory,
      },
    },
  })
}

function boot(input: { directory: string; init?: () => Promise<void>; project?: Project.Info; worktree?: string }) {
  return iife(async () => {
    const ctx =
      input.project && input.worktree
        ? {
            directory: input.directory,
            worktree: input.worktree,
            project: input.project,
          }
        : await iife(async () => {
            const resolved = await Project.resolve(input.directory)
            let project = Project.get(resolved.id)
            if (!project) {
              // ID changed (e.g. .git deleted or git init + first commit).
              // Re-register via fromDirectory() which triggers the migration
              // in Project.register() to update all child table references.
              Log.Default.info("project ID mismatch, re-registering", {
                directory: input.directory,
                resolvedId: resolved.id,
              })
              const registered = await Project.fromDirectory(input.directory)
              project = registered.project
            }
            return {
              directory: input.directory,
              worktree: resolved.sandbox,
              project,
            }
          })
    await context.provide(ctx, async () => {
      await input.init?.()
    })
    return ctx
  })
}

function track(directory: string, next: Promise<InstanceContext>) {
  const task = next.catch((error) => {
    if (cache.get(directory) === task) cache.delete(directory)
    throw error
  })
  cache.set(directory, task)
  return task
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<void>; fn: () => R }): Promise<R> {
    const directory = Filesystem.resolve(input.directory)
    let existing = cache.get(directory)
    if (!existing) {
      if (halted.has(directory)) {
        throw new Error(`Instance for ${directory} halted due to reboot loop — restart the server to recover`)
      }
      Log.Default.info("creating instance", { directory })
      existing = track(
        directory,
        boot({
          directory,
          init: input.init,
        }),
      )
    }
    const ctx = await existing
    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string) {
    if (Filesystem.contains(Instance.directory, filepath)) return true
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // Skip worktree check in this case to preserve external_directory permissions.
    if (Instance.worktree === "/") return false
    return Filesystem.contains(Instance.worktree, filepath)
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async reload(input: { directory: string; init?: () => Promise<void>; project?: Project.Info; worktree?: string }) {
    const directory = Filesystem.resolve(input.directory)
    Log.Default.info("reloading instance", { directory })
    await Promise.all([State.dispose(directory), Effect.runPromise(InstanceState.dispose(directory))])
    cache.delete(directory)
    const next = track(directory, boot({ ...input, directory }))
    emit(directory)
    return await next
  },
  async dispose() {
    const directory = Instance.directory
    Log.Default.warn("disposing instance", { directory })
    if (!trackReboot(directory)) {
      Log.Default.error("skipping dispose — reboot loop detected, instance will not be recreated", { directory })
    }
    await Promise.all([State.dispose(directory), Effect.runPromise(InstanceState.dispose(directory))])
    cache.delete(directory)
    emit(directory)
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
      const entries = [...cache.entries()]
      for (const [key, value] of entries) {
        if (cache.get(key) !== value) continue

        const ctx = await value.catch((error) => {
          Log.Default.warn("instance dispose failed", { key, error })
          return undefined
        })

        if (!ctx) {
          if (cache.get(key) === value) cache.delete(key)
          continue
        }

        if (cache.get(key) !== value) continue

        await context.provide(ctx, async () => {
          await Instance.dispose()
        })
      }
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },
}
