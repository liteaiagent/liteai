import os from "node:os"
import path from "node:path"
import { NamedError } from "@liteai/util/error"
import { Bundled } from "@/bundled"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import * as Platform from "@/platform"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@/util/glob"
import { Log } from "@/util/log"
import { Discovery } from "./discovery"
import { Skill } from "./skill"

const log = Log.create({ service: "skill:loader" })

const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const CONFIG_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"

export namespace SkillLoader {
  export async function parseSkill(match: string): Promise<Skill.Info | undefined> {
    const md = await ConfigMarkdown.parse(match).catch((err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse skill ${match}`
      Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load skill", { skill: match, err })
      return undefined
    })

    if (!md) return undefined

    const parsed = Skill.Info.pick({
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

    if (!parsed.success) return undefined

    return {
      ...parsed.data,
      location: match,
      content: md.content,
    } as Skill.Info
  }

  export async function load(): Promise<{ skills: Record<string, Skill.Info>; dirs: string[] }> {
    const skills: Record<string, Skill.Info> = {}
    const dirs = new Set<string>()

    const addSkill = async (match: string, source: string) => {
      const parsed = await parseSkill(match)
      if (!parsed) return

      // Warn on duplicate skill names (unless it's bundled being silently skipped)
      if (skills[parsed.name] && source !== "bundled") {
        log.warn("duplicate skill name", {
          name: parsed.name,
          existing: skills[parsed.name].location,
          duplicate: match,
        })
      }

      dirs.add(path.dirname(match))

      // Do not overwrite existing higher priority skills with bundled ones
      if (source === "bundled" && skills[parsed.name]) return

      log.info("loaded skill", { name: parsed.name, path: match, source })
      parsed.native = source === "bundled"
      skills[parsed.name] = parsed
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
        .then((matches) => Promise.all(matches.map((m) => addSkill(m, scope))))
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
        await addSkill(match, "config_dir")
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
        await addSkill(match, "config_path")
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
          await addSkill(match, "url")
        }
      }
    }

    // Load bundled skills (lowest priority — user/project skills override)
    const bundled = Bundled.skillsDir()
    if (await Filesystem.isDir(bundled)) {
      log.info("scanning for bundled skills", { dir: bundled })
      const matches = await Glob.scan(SKILL_PATTERN, {
        cwd: bundled,
        absolute: true,
        include: "file",
        symlink: true,
      })
      for (const match of matches) {
        await addSkill(match, "bundled")
      }
    }

    // Load plugin skills
    for (const skill of await Config.pluginSkills()) {
      if (!skills[skill.name]) {
        log.info("loaded plugin skill", { name: skill.name, path: skill.location })
        dirs.add(path.dirname(skill.location))
        skills[skill.name] = skill as Skill.Info
      }
    }

    // Process enabled state based on global config
    for (const skill of Object.values(skills)) {
      skill.enabled = !(config.disabledSkills?.[skill.name] === true)
    }

    return {
      skills,
      dirs: Array.from(dirs),
    }
  }

  export async function resolveSkillName(
    name: string,
    allSkills?: Record<string, Skill.Info>,
  ): Promise<Skill.Info | undefined> {
    const loaded = allSkills ?? (await load()).skills

    // Strategy 1: Exact match
    if (loaded[name]) {
      return loaded[name]
    }

    // Strategy 2: Plugin-prefix match
    // Check if the requested name matches a suffix of a loaded skill,
    // or if the requested name is a suffix and we find a match
    const suffixMatches = Object.keys(loaded).filter((key) => key.endsWith(`/${name}`))
    if (suffixMatches.length === 1) {
      return loaded[suffixMatches[0]]
    } else if (suffixMatches.length > 1) {
      log.warn("multiple skills matched suffix, using deterministic first sorted match", {
        name,
        matches: suffixMatches,
      })
      suffixMatches.sort()
      return loaded[suffixMatches[0]]
    }

    const reverseMatches = Object.keys(loaded).filter((key) => name.endsWith(`/${key}`))
    if (reverseMatches.length === 1) {
      return loaded[reverseMatches[0]]
    } else if (reverseMatches.length > 1) {
      log.warn("multiple skills matched reverse suffix, using deterministic first sorted match", {
        name,
        matches: reverseMatches,
      })
      reverseMatches.sort()
      return loaded[reverseMatches[0]]
    }

    log.debug("failed to resolve skill name, skipping", { name })
    return undefined
  }

  const invokedSkillsByAgent = new Map<string, Set<string>>()

  export function registerInvokedSkill(agentId: string, skillName: string) {
    if (!invokedSkillsByAgent.has(agentId)) {
      invokedSkillsByAgent.set(agentId, new Set())
    }
    invokedSkillsByAgent.get(agentId)?.add(skillName)
  }

  export function clearInvokedSkillsForAgent(agentId: string) {
    invokedSkillsByAgent.delete(agentId)
  }
}
