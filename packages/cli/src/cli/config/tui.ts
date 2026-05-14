import { existsSync } from "node:fs"
import path from "node:path"
import { Brand } from "@liteai/core/brand"
import { Config } from "@liteai/core/config/config"
import { ConfigPaths } from "@liteai/core/config/paths"
import { Flag } from "@liteai/core/flag/flag"
import { Global } from "@liteai/core/global/index"
import { Instance } from "@liteai/core/project/instance"
import { Filesystem } from "@liteai/core/util/filesystem"
import { Log } from "@liteai/util/log"
import { applyEdits, modify } from "jsonc-parser"
import { mergeDeep, unique } from "remeda"
import type z from "zod"
import type { KeybindingContextName } from "../../tui/keybindings/types"
import { TuiInfo } from "./tui-schema"

export namespace TuiConfig {
  const log = Log.create({ service: "config.tui" })

  export const Info = TuiInfo

  export type Info = z.output<typeof Info>

  function mergeInfo(target: Info, source: Info): Info {
    const result = mergeDeep(target, source)
    if (target.keybinds && source.keybinds) {
      const byContext = new Map<string, Record<string, string | null>>()
      for (const kb of target.keybinds) {
        byContext.set(kb.context, { ...kb.bindings })
      }
      for (const kb of source.keybinds) {
        const existing = byContext.get(kb.context) || {}
        byContext.set(kb.context, { ...existing, ...kb.bindings })
      }
      result.keybinds = Array.from(byContext.entries()).map(([context, bindings]) => ({
        context: context as KeybindingContextName,
        bindings,
      }))
    } else if (target.keybinds) {
      result.keybinds = target.keybinds
    } else if (source.keybinds) {
      result.keybinds = source.keybinds
    }
    return result
  }

  function customPath() {
    return Flag.LITEAI_TUI_CONFIG
  }

  const state = Instance.state(async () => {
    const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)
    const custom = customPath()
    const managed = Config.managedConfigDir()

    // Start with portable settings from core config's `tui` namespace (settings.json).
    // This gives cross-machine sync for free — the backend manages settings.json.
    const coreConfig = await Config.get()
    // Core schema uses broad `string` for keybinds.context; CLI uses a narrow enum.
    // The cast is safe — mergeInfo validates context values downstream.
    let result: Info = (coreConfig.tui as Info) ?? {}

    // Overlay local tui.json files (machine-specific overrides take precedence)
    for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
      result = mergeInfo(result, await loadFile(file))
    }

    if (custom) {
      result = mergeInfo(result, await loadFile(custom))
      log.debug("loaded custom tui config", { path: custom })
    }

    for (const dir of unique(directories)) {
      if (!dir.endsWith(Brand.dir) && dir !== Flag.LITEAI_CONFIG_DIR) continue
      for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
        result = mergeInfo(result, await loadFile(file))
      }
    }

    if (existsSync(managed)) {
      for (const file of ConfigPaths.fileInDirectory(managed, "tui")) {
        result = mergeInfo(result, await loadFile(file))
      }
    }

    return {
      config: result,
    }
  })

  export async function get() {
    return state().then((x) => x.config)
  }

  async function loadFile(filepath: string): Promise<Info> {
    const text = await ConfigPaths.readFile(filepath)
    if (!text) return {}
    return load(text, filepath).catch((error) => {
      log.warn("failed to load tui config", { path: filepath, error })
      return {}
    })
  }

  async function load(text: string, configFilepath: string): Promise<Info> {
    const data = await ConfigPaths.parseText(text, configFilepath, "empty")
    if (!data || typeof data !== "object" || Array.isArray(data)) return {}

    // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
    // (mirroring the old liteai.json shape) still get their settings applied.
    const normalized = (() => {
      const copy = { ...(data as Record<string, unknown>) }
      if (!("tui" in copy)) return copy
      if (!copy.tui || typeof copy.tui !== "object" || Array.isArray(copy.tui)) {
        delete copy.tui
        return copy
      }
      const tui = copy.tui as Record<string, unknown>
      delete copy.tui
      return {
        ...tui,
        ...copy,
      }
    })()

    const parsed = Info.safeParse(normalized)
    if (!parsed.success) {
      log.warn("invalid tui config", { path: configFilepath, issues: parsed.error.issues })
      return {}
    }

    return parsed.data
  }

  /**
   * Persist a partial TUI config update to the core settings.json `tui` namespace.
   * Uses JSONC-aware patching via Config.updateGlobal() for cross-machine sync.
   *
   * Falls back to local tui.json patching if core config write fails (file-lock, etc).
   */
  export async function update(patch: Partial<Info>): Promise<void> {
    try {
      // Write to core config's `tui` namespace — this is the portable path.
      // Config.updateGlobal merges deeply, so we wrap in { tui: ... }.
      await Config.updateGlobal({ tui: patch })
      log.info("persisted tui config to settings.json", { keys: Object.keys(patch) })
    } catch (error) {
      // Fallback: write to local tui.json if core config is unavailable.
      log.warn("failed to write to settings.json, falling back to tui.json", { error })
      const filepath = path.join(Global.Path.config, "tui.json")
      const before = await Filesystem.readText(filepath).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return "{}"
        throw err
      })

      let updated = before
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue
        const edits = modify(updated, [key], value, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        })
        updated = applyEdits(updated, edits)
      }

      await Filesystem.write(filepath, updated)
      log.info("persisted tui config to tui.json (fallback)", { filepath, keys: Object.keys(patch) })
    }
  }
}
