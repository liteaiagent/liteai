import { Ansi, Box } from "@liteai/ink"
import chalk from "chalk"
import { structuredPatch } from "diff"
import type React from "react"
import { useMemo } from "react"
import { type ThemeColors, useTheme } from "../context/theme.tsx"
import { generateDiffLines } from "../util/diff.ts"

type StructuredDiffProps = {
  originalContent?: string
  modifiedContent: string
  width?: number
  dim?: boolean
}

// 1. Map cache tied to the content strings
const diffCache = new Map<
  string,
  Map<
    string,
    {
      rendered: string
      width: number
      theme: ThemeColors
      dim: boolean
    }
  >
>()

function renderColorDiff(original: string, modified: string, width: number, theme: ThemeColors, dim: boolean): string {
  let innerCache = diffCache.get(original)
  if (!innerCache) {
    innerCache = new Map()
    diffCache.set(original, innerCache)
  }

  const cached = innerCache.get(modified)
  if (cached && cached.width === width && cached.theme === theme && cached.dim === dim) {
    return cached.rendered
  }

  const patch = structuredPatch("old", "new", original, modified)
  if (!patch.hunks || patch.hunks.length === 0) return ""

  let rendered = ""

  for (const hunk of patch.hunks) {
    const lines = generateDiffLines(hunk)
    const hasMultipleLines = lines.length > 1

    // Max line number for gutter padding
    const maxLineNum = lines.reduce((max, line) => Math.max(max, line.oldNum ?? 0, line.newNum ?? 0), 0)
    const gutterWidth = Math.max(3, maxLineNum.toString().length)
    // TODO: word-level diff highlighting and content-width constraining deferred

    const c = (name: keyof ThemeColors) => {
      const fn = chalk.hex(theme[name] || theme.text)
      if (dim) {
        return (t: string) => `\x1b[2m${fn(t)}\x1b[22m`
      }
      return fn
    }

    const cAdd = c("success")
    const cAddBg = chalk.bgHex(theme.diffAddedBg || theme.success).hex(theme.text)
    const cRemove = c("error")
    const cRemoveBg = chalk.bgHex(theme.diffRemovedBg || theme.error).hex(theme.text)
    const cDim = c("textMuted")
    const cText = c("text")

    for (const line of lines) {
      if (hasMultipleLines) {
        const oldNum = line.oldNum ? line.oldNum.toString().padStart(gutterWidth) : " ".repeat(gutterWidth)
        const newNum = line.newNum ? line.newNum.toString().padStart(gutterWidth) : " ".repeat(gutterWidth)

        let gutterColor = cDim
        if (line.type === "add") gutterColor = cAdd
        else if (line.type === "remove") gutterColor = cRemove

        rendered += gutterColor(`${oldNum} ${newNum} │ `)
      }

      let linePrefix = " "
      let lineFormat = cText

      if (line.type === "add") {
        linePrefix = "+"
        lineFormat = cAdd
      } else if (line.type === "remove") {
        linePrefix = "-"
        lineFormat = cRemove
      }

      rendered += `${lineFormat(linePrefix)} `

      // Since word-diffing is complex, we'll just color the whole line here
      if (line.type === "add") rendered += cAddBg(line.text)
      else if (line.type === "remove") rendered += cRemoveBg(line.text)
      else rendered += cText(line.text)

      rendered += "\n"
    }
  }

  rendered = rendered.trimEnd()

  innerCache?.set(modified, {
    rendered,
    width,
    theme,
    dim,
  })

  return rendered
}

export function StructuredDiff({
  originalContent = "",
  modifiedContent,
  width = 80,
  dim = false,
}: StructuredDiffProps): React.ReactNode {
  const { theme } = useTheme()

  const rendered = useMemo(() => {
    return renderColorDiff(originalContent, modifiedContent, width, theme, dim)
  }, [originalContent, modifiedContent, width, theme, dim])

  return (
    <Box flexDirection="column" width={width}>
      <Ansi>{rendered}</Ansi>
    </Box>
  )
}
