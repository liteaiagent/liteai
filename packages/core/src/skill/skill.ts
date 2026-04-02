import os from "node:os"
import path from "node:path"
import { NamedError } from "@liteai/util/error"
import z from "zod"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { PermissionNext } from "@/permission/next"
import * as Platform from "@/platform"
import { Session } from "@/session"
import { Filesystem } from "@/util/filesystem"
import { Config } from "../config/config"
import { ConfigMarkdown } from "../config/markdown"
import { Instance } from "../project/instance"
import { Glob } from "../util/glob"
import { Log } from "../util/log"
import { Discovery } from "./discovery"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    content: z.string(),
    argument_hint: z.string().optional(),
    disable_model_invocation: z.boolean().optional(),
    user_invocable: z.boolean().optional(),
    allowed_tools: z.string().optional(),
    model: z.string().optional(),
    context: z.enum(["fork"]).optional(),
    agent: z.string().optional(),
    hooks: z.record(z.string(), z.unknown()).optional(),
  })
  export type Info = z.infer<typeof Info>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  // External skill directories to search for (project-level and global).
  // Driven by the active platform profile + neutral .agents/ convention.
  const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
  const CONFIG_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
  const SKILL_PATTERN = "**/SKILL.md"

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}
    const dirs = new Set<string>()

    const addSkill = async (match: string) => {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      })

      if (!md) return

      const parsed = Info.pick({
        name: true,
        description: true,
        argument_hint: true,
        disable_model_invocation: true,
        user_invocable: true,
        allowed_tools: true,
        model: true,
        context: true,
        agent: true,
        hooks: true,
      }).safeParse({
        ...md.data,
        // normalize kebab-case keys from frontmatter to snake_case
        argument_hint: md.data["argument-hint"] ?? md.data.argument_hint,
        disable_model_invocation: md.data["disable-model-invocation"] ?? md.data.disable_model_invocation,
        user_invocable: md.data["user-invocable"] ?? md.data.user_invocable,
        allowed_tools: md.data["allowed-tools"] ?? md.data.allowed_tools,
      })
      if (!parsed.success) return

      // Warn on duplicate skill names
      if (skills[parsed.data.name]) {
        log.warn("duplicate skill name", {
          name: parsed.data.name,
          existing: skills[parsed.data.name].location,
          duplicate: match,
        })
      }

      dirs.add(path.dirname(match))

      log.info("loaded skill", { name: parsed.data.name, path: match })
      skills[parsed.data.name] = {
        ...parsed.data,
        location: match,
        content: md.content,
      }
    }

    const scanPlatform = async (root: string, scope: "global" | "project") => {
      log.info("scanning for platform skills", { scope, dir: root })
      return Glob.scan(EXTERNAL_SKILL_PATTERN, {
        cwd: root,
        absolute: true,
        include: "file",
        dot: true,
        symlink: true,
      })
        .then((matches) => Promise.all(matches.map(addSkill)))
        .catch((error) => {
          log.error(`failed to scan ${scope} skills`, { dir: root, error })
        })
    }

    // Scan platform skill directories
    // Load global (home) first, then project-level (so project-level overwrites)
    if (!Flag.LITEAI_DISABLE_SKILLS) {
      for (const dir of Platform.dirs()) {
        const root = path.join(Global.Path.home, dir)
        if (!(await Filesystem.isDir(root))) continue
        await scanPlatform(root, "global")
      }

      for await (const root of Filesystem.up({
        targets: Platform.dirs(),
        start: Instance.directory,
        stop: Instance.worktree,
      })) {
        await scanPlatform(root, "project")
      }
    }

    // Scan <Brand.dir>/skill/ directories (e.g. .liteai/skill/)
    const cfgDirs = [...new Set(await Config.directories())]
    for (const dir of cfgDirs) {
      log.info("scanning for skills", { dir })
      const matches = await Glob.scan(CONFIG_SKILL_PATTERN, {
        cwd: dir,
        absolute: true,
        include: "file",
        symlink: true,
      })
      for (const match of matches) {
        await addSkill(match)
      }
    }

    // Scan additional skill paths from config
    const config = await Config.get()
    for (const skillPath of config.skills?.paths ?? []) {
      const expanded = skillPath.startsWith("~/") ? path.join(os.homedir(), skillPath.slice(2)) : skillPath
      const resolved = path.isAbsolute(expanded) ? expanded : path.join(Instance.directory, expanded)
      if (!(await Filesystem.isDir(resolved))) {
        log.warn("skill path not found", { path: resolved })
        continue
      }
      log.info("scanning for skills from config path", { path: resolved })
      const matches = await Glob.scan(SKILL_PATTERN, {
        cwd: resolved,
        absolute: true,
        include: "file",
        symlink: true,
      })
      for (const match of matches) {
        await addSkill(match)
      }
    }

    // Download and load skills from URLs
    for (const url of config.skills?.urls ?? []) {
      log.info("scanning for skills from url", { url })
      const list = await Discovery.pull(url)
      for (const dir of list) {
        dirs.add(dir)
        const matches = await Glob.scan(SKILL_PATTERN, {
          cwd: dir,
          absolute: true,
          include: "file",
          symlink: true,
        })
        for (const match of matches) {
          await addSkill(match)
        }
      }
    }

    // Load bundled skills (lowest priority — user/project skills override)
    const bundled = path.join(import.meta.dir, "bundled")
    if (await Filesystem.isDir(bundled)) {
      log.info("scanning for bundled skills", { dir: bundled })
      const matches = await Glob.scan(SKILL_PATTERN, {
        cwd: bundled,
        absolute: true,
        include: "file",
        symlink: true,
      })
      for (const match of matches) {
        // Only add if no skill with this name was loaded from user/project sources
        const md = await ConfigMarkdown.parse(match).catch((e) => {
          log.debug("failed to parse bundled skill", { path: match, error: e })
          return undefined
        })
        if (md?.data?.name && !skills[md.data.name]) {
          await addSkill(match)
        }
      }
    }

    // Load plugin skills — collected by loader.ts from both --plugin-dir and registry plugins
    // (same loading path as agents, hooks, commands, and mcp)
    for (const skill of await Config.pluginSkills()) {
      if (!skills[skill.name]) {
        log.info("loaded plugin skill", { name: skill.name, path: skill.location })
        dirs.add(path.dirname(skill.location))
        skills[skill.name] = skill as Skill.Info
      }
    }

    return {
      skills,
      dirs: Array.from(dirs),
    }
  })

  export async function get(name: string) {
    return state().then((x) => x.skills[name])
  }

  export async function all() {
    return state().then((x) => Object.values(x.skills))
  }

  export async function dirs() {
    return state().then((x) => x.dirs)
  }

  export async function available(agent?: Agent.Info, invoker?: "user" | "model") {
    const list = await all()
    return list.filter((skill) => {
      if (agent && PermissionNext.evaluate("skill", skill.name, agent.permission).action === "deny") return false
      if (invoker === "model" && skill.disable_model_invocation) return false
      if (invoker === "user" && skill.user_invocable === false) return false
      return true
    })
  }

  export function fmt(list: Info[], opts: { verbose: boolean }) {
    if (list.length === 0) {
      return "No skills are currently available."
    }
    if (opts.verbose) {
      return [
        "<available_skills>",
        ...list.flatMap((skill) => [
          `  <skill>`,
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          ...(skill.argument_hint ? [`    <argument_hint>${skill.argument_hint}</argument_hint>`] : []),
          `  </skill>`,
        ]),
        "</available_skills>",
      ].join("\n")
    }
    return [
      "## Available Skills",
      ...list.flatMap((skill) => {
        const hint = skill.argument_hint ? ` ${skill.argument_hint}` : ""
        return `- **${skill.name}**${hint}: ${skill.description}`
      }),
    ].join("\n")
  }
}
