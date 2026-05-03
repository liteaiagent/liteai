import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import z from "zod"
import { Brand } from "../brand"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

const log = Log.create({ service: "style" })

export namespace OutputStyle {
  /** Metadata parsed from a style file's YAML frontmatter or inferred from filename. */
  export const Info = z.object({
    name: z.string().describe("Unique style identifier (filename without extension)"),
    title: z.string().describe("Human-readable title for the style"),
    description: z.string().optional().describe("Short description of what this style does"),
    content: z.string().describe("The style prompt content injected into the system prompt"),
  })
  export type Info = z.infer<typeof Info>

  /**
   * List all available output styles from `.liteai/styles/` in the project directory.
   * Each .md file in the directory is treated as a style definition.
   */
  export async function list(): Promise<Info[]> {
    const stylesDir = path.join(Instance.directory, Brand.dir, "styles")
    const exists = await Filesystem.exists(stylesDir)
    if (!exists) return []

    const entries = await fs.readdir(stylesDir).catch(() => [] as string[])

    const styles: Info[] = []
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue
      const filePath = path.join(stylesDir, entry)
      const name = path.basename(entry, ".md")

      try {
        const raw = await Filesystem.readText(filePath)
        const parsed = parseFrontmatter(raw)
        styles.push({
          name,
          title: parsed.title ?? name,
          description: parsed.description,
          content: parsed.body,
        })
      } catch (err) {
        log.warn("failed to read style file", { path: filePath, error: err })
      }
    }
    return styles
  }

  /**
   * Get the currently active output style based on the config.
   * Returns null if no style is configured or the configured style is not found.
   */
  export async function active(): Promise<Info | null> {
    const config = await Config.get()
    const styleName = config.outputStyle
    if (!styleName) return null

    const styles = await list()
    return styles.find((s) => s.name === styleName) ?? null
  }

  /**
   * Minimal YAML-like frontmatter parser for style files.
   * Extracts `title` and `description` from frontmatter delimited by `---`.
   */
  function parseFrontmatter(content: string): {
    title?: string
    description?: string
    body: string
  } {
    const trimmed = content.trimStart()
    if (!trimmed.startsWith("---")) {
      return { body: content.trim() }
    }

    const endIndex = trimmed.indexOf("---", 3)
    if (endIndex === -1) {
      return { body: content.trim() }
    }

    const frontmatter = trimmed.substring(3, endIndex).trim()
    const body = trimmed.substring(endIndex + 3).trim()

    let title: string | undefined
    let description: string | undefined

    for (const line of frontmatter.split("\n")) {
      const colonIdx = line.indexOf(":")
      if (colonIdx === -1) continue
      const key = line.substring(0, colonIdx).trim().toLowerCase()
      const value = line.substring(colonIdx + 1).trim()
      if (key === "title") title = value
      if (key === "description") description = value
    }

    return { title, description, body }
  }
}
