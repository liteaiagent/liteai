/** @jsxImportSource react */
import path from "node:path"
import { Global } from "@liteai/core/global/index"
import { Filesystem } from "@liteai/core/util/filesystem"
import { Glob } from "@liteai/core/util/glob"
import { type TerminalColors as InkTerminalColors, useApp } from "@liteai/ink"
import { RGBA, SyntaxStyle } from "@opentui/core"
import { useEffect, useMemo, useState } from "react"
import { createSimpleContext } from "./helper"
import { useKV } from "./kv"
import aura from "./theme/aura.json" with { type: "json" }
import ayu from "./theme/ayu.json" with { type: "json" }
import carbonfox from "./theme/carbonfox.json" with { type: "json" }
import catppuccin from "./theme/catppuccin.json" with { type: "json" }
import catppuccinFrappe from "./theme/catppuccin-frappe.json" with { type: "json" }
import catppuccinMacchiato from "./theme/catppuccin-macchiato.json" with { type: "json" }
import cobalt2 from "./theme/cobalt2.json" with { type: "json" }
import cursor from "./theme/cursor.json" with { type: "json" }
import dracula from "./theme/dracula.json" with { type: "json" }
import everforest from "./theme/everforest.json" with { type: "json" }
import flexoki from "./theme/flexoki.json" with { type: "json" }
import github from "./theme/github.json" with { type: "json" }
import gruvbox from "./theme/gruvbox.json" with { type: "json" }
import kanagawa from "./theme/kanagawa.json" with { type: "json" }
import liteai from "./theme/liteai.json" with { type: "json" }
import lucentOrng from "./theme/lucent-orng.json" with { type: "json" }
import material from "./theme/material.json" with { type: "json" }
import matrix from "./theme/matrix.json" with { type: "json" }
import mercury from "./theme/mercury.json" with { type: "json" }
import monokai from "./theme/monokai.json" with { type: "json" }
import nightowl from "./theme/nightowl.json" with { type: "json" }
import nord from "./theme/nord.json" with { type: "json" }
import onedark from "./theme/one-dark.json" with { type: "json" }
import orng from "./theme/orng.json" with { type: "json" }
import osakaJade from "./theme/osaka-jade.json" with { type: "json" }
import palenight from "./theme/palenight.json" with { type: "json" }
import rosepine from "./theme/rosepine.json" with { type: "json" }
import solarized from "./theme/solarized.json" with { type: "json" }
import synthwave84 from "./theme/synthwave84.json" with { type: "json" }
import tokyonight from "./theme/tokyonight.json" with { type: "json" }
import vercel from "./theme/vercel.json" with { type: "json" }
import vesper from "./theme/vesper.json" with { type: "json" }
import zenburn from "./theme/zenburn.json" with { type: "json" }
import { useTuiConfig } from "./tui-config"

export type ThemeColors = {
  primary: RGBA
  secondary: RGBA
  accent: RGBA
  error: RGBA
  warning: RGBA
  success: RGBA
  info: RGBA
  text: RGBA
  textMuted: RGBA
  selectedListItemText: RGBA
  background: RGBA
  backgroundPanel: RGBA
  backgroundElement: RGBA
  backgroundMenu: RGBA
  border: RGBA
  borderActive: RGBA
  borderSubtle: RGBA
  diffAdded: RGBA
  diffRemoved: RGBA
  diffContext: RGBA
  diffHunkHeader: RGBA
  diffHighlightAdded: RGBA
  diffHighlightRemoved: RGBA
  diffAddedBg: RGBA
  diffRemovedBg: RGBA
  diffContextBg: RGBA
  diffLineNumber: RGBA
  diffAddedLineNumberBg: RGBA
  diffRemovedLineNumberBg: RGBA
  markdownText: RGBA
  markdownHeading: RGBA
  markdownLink: RGBA
  markdownLinkText: RGBA
  markdownCode: RGBA
  markdownBlockQuote: RGBA
  markdownEmph: RGBA
  markdownStrong: RGBA
  markdownHorizontalRule: RGBA
  markdownListItem: RGBA
  markdownListEnumeration: RGBA
  markdownImage: RGBA
  markdownImageText: RGBA
  markdownCodeBlock: RGBA
  syntaxComment: RGBA
  syntaxKeyword: RGBA
  syntaxFunction: RGBA
  syntaxVariable: RGBA
  syntaxString: RGBA
  syntaxNumber: RGBA
  syntaxType: RGBA
  syntaxOperator: RGBA
  syntaxPunctuation: RGBA
}

export type Theme = ThemeColors & {
  _hasSelectedListItemText: boolean
  thinkingOpacity: number
}

export function selectedForeground(theme: Theme, bg?: RGBA): RGBA {
  if (theme._hasSelectedListItemText) {
    return theme.selectedListItemText
  }

  if (theme.background.a === 0) {
    const targetColor = bg ?? theme.primary
    const { r, g, b } = targetColor
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
  }

  return theme.background
}

type HexColor = `#${string}`
type RefName = string
type Variant = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
type ColorValue = HexColor | RefName | Variant | RGBA
type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Omit<Record<keyof ThemeColors, ColorValue>, "selectedListItemText" | "backgroundMenu"> & {
    selectedListItemText?: ColorValue
    backgroundMenu?: ColorValue
    thinkingOpacity?: number
  }
}

export const DEFAULT_THEMES: Record<string, ThemeJson> = {
  aura,
  ayu,
  catppuccin,
  "catppuccin-frappe": catppuccinFrappe,
  "catppuccin-macchiato": catppuccinMacchiato,
  cobalt2,
  cursor,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  "one-dark": onedark,
  "osaka-jade": osakaJade,
  liteai,
  orng,
  "lucent-orng": lucentOrng,
  palenight,
  rosepine,
  solarized,
  synthwave84,
  tokyonight,
  vesper,
  vercel,
  zenburn,
  carbonfox,
}

function resolveTheme(theme: ThemeJson, mode: "dark" | "light"): Theme {
  const defs = theme.defs ?? {}
  function resolveColor(c: ColorValue): RGBA {
    if (c instanceof RGBA) return c
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)
      if (c.startsWith("#")) return RGBA.fromHex(c)
      if (defs[c] != null) return resolveColor(defs[c])
      const ref = theme.theme[c as keyof ThemeColors]
      if (ref !== undefined) return resolveColor(ref)
      throw new Error(`Color reference "${c}" not found in defs or theme`)
    }
    if (typeof c === "number") return ansiToRgba(c)
    return resolveColor(c[mode])
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
      .map(([key, value]) => [key, resolveColor(value as ColorValue)]),
  ) as Partial<ThemeColors>

  const selectedText = theme.theme.selectedListItemText
  const hasSelectedListItemText = selectedText !== undefined
  resolved.selectedListItemText = hasSelectedListItemText
    ? resolveColor(selectedText)
    : (resolved.background ?? RGBA.fromInts(0, 0, 0))

  resolved.backgroundMenu =
    theme.theme.backgroundMenu !== undefined
      ? resolveColor(theme.theme.backgroundMenu)
      : (resolved.backgroundElement ?? RGBA.fromInts(0, 0, 0))

  const thinkingOpacity = theme.theme.thinkingOpacity ?? 0.6

  return {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
    thinkingOpacity,
  } as Theme
}

function ansiToRgba(code: number): RGBA {
  if (code < 16) {
    const ansiColors = [
      "#000000",
      "#800000",
      "#008000",
      "#808000",
      "#000080",
      "#800080",
      "#008080",
      "#c0c0c0",
      "#808080",
      "#ff0000",
      "#00ff00",
      "#ffff00",
      "#0000ff",
      "#ff00ff",
      "#00ffff",
      "#ffffff",
    ]
    return RGBA.fromHex(ansiColors[code] ?? "#000000")
  }
  if (code < 232) {
    const index = code - 16
    const b = index % 6
    const g = Math.floor(index / 6) % 6
    const r = Math.floor(index / 36)
    const val = (x: number) => (x === 0 ? 0 : x * 40 + 55)
    return RGBA.fromInts(val(r), val(g), val(b))
  }
  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }
  return RGBA.fromInts(0, 0, 0)
}

export type ThemeContextValue = {
  theme: Theme
  selected: string
  all: () => Record<string, ThemeJson>
  syntax: SyntaxStyle
  subtleSyntax: SyntaxStyle
  mode: () => "dark" | "light"
  setMode: (mode: "dark" | "light") => void
  set: (theme: string) => void
  ready: boolean
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light" }) => {
    const config = useTuiConfig()
    const kv = useKV()
    const { getPalette, clearPaletteCache } = useApp()

    const [themes, setThemes] = useState<Record<string, ThemeJson>>(DEFAULT_THEMES)
    const [mode, setModeState] = useState<"dark" | "light">(kv.get("theme_mode", props.mode) as "dark" | "light")
    const [active, setActive] = useState<string>((config.theme ?? kv.get("theme", "liteai")) as string)
    const [ready, setReady] = useState(false)

    useEffect(() => {
      if (config.theme) setActive(config.theme)
    }, [config.theme])

    const resolveSystemTheme = async (currentMode: "dark" | "light") => {
      const colors = await getPalette({ size: 16 })
      if (!colors.palette[0]) {
        if (active === "system") {
          setActive("liteai")
          setReady(true)
        }
        return
      }
      setThemes((prev) => ({
        ...prev,
        system: generateSystem(colors, currentMode),
      }))
      if (active === "system") {
        setReady(true)
      }
    }

    const init = async () => {
      await resolveSystemTheme(mode)
      try {
        const custom = await getCustomThemes()
        setThemes((prev) => ({ ...prev, ...custom }))
      } catch {
        setActive("liteai")
      } finally {
        if (active !== "system") {
          setReady(true)
        }
      }
    }

    useEffect(() => {
      init()
    }, [])

    useEffect(() => {
      const handler = async () => {
        clearPaletteCache()
        await init()
      }
      process.on("SIGUSR2", handler)
      return () => {
        process.off("SIGUSR2", handler)
      }
    }, [clearPaletteCache])

    const values = useMemo(() => {
      return resolveTheme(themes[active] ?? themes.liteai, mode)
    }, [themes, active, mode])

    const syntax = useMemo(() => generateSyntax(values), [values])
    const subtleSyntax = useMemo(() => generateSubtleSyntax(values), [values])

    return useMemo(
      () => ({
        theme: values,
        selected: active,
        all: () => themes,
        syntax,
        subtleSyntax,
        mode: () => mode,
        setMode: (m: "dark" | "light") => {
          setModeState(m)
          kv.set("theme_mode", m)
        },
        set: (t: string) => {
          setActive(t)
          kv.set("theme", t)
        },
        ready,
      }),
      [values, active, themes, syntax, subtleSyntax, mode, ready, kv],
    )
  },
})

async function getCustomThemes() {
  const directories = [
    Global.Path.config,
    ...(await Array.fromAsync(Filesystem.up({ targets: [".liteai"], start: process.cwd() }))),
  ]

  const result: Record<string, ThemeJson> = {}
  for (const dir of directories) {
    try {
      const themeFiles = await Glob.scan("themes/*.json", { cwd: dir, absolute: true, dot: true, symlink: true })
      for (const item of themeFiles) {
        const name = path.basename(item, ".json")
        result[name] = await Filesystem.readJson(item)
      }
    } catch {
      /* ignore directory errors */
    }
  }
  return result
}

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha
  const g = base.g + (overlay.g - base.g) * alpha
  const b = base.b + (overlay.b - base.b) * alpha
  return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
}

function generateSystem(colors: InkTerminalColors, mode: "dark" | "light"): ThemeJson {
  const bg = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0] ?? "#000000")
  const fg = RGBA.fromHex(colors.defaultForeground ?? colors.palette[7] ?? "#c0c0c0")
  const transparent = RGBA.fromInts(0, 0, 0, 0)
  const isDark = mode === "dark"

  const col = (i: number) => {
    const value = colors.palette[i]
    return value ? RGBA.fromHex(value) : ansiToRgba(i)
  }

  const grays = generateGrayScale(bg, isDark)
  const textMuted = generateMutedTextColor(bg, isDark)

  const ansiColors = {
    black: col(0),
    red: col(1),
    green: col(2),
    yellow: col(3),
    blue: col(4),
    magenta: col(5),
    cyan: col(6),
    white: col(7),
    redBright: col(9),
    greenBright: col(10),
  }

  const diffAlpha = isDark ? 0.22 : 0.14
  const diffAddedBg = tint(bg, ansiColors.green, diffAlpha)
  const diffRemovedBg = tint(bg, ansiColors.red, diffAlpha)
  const diffAddedLineNumberBg = tint(grays[3], ansiColors.green, diffAlpha)
  const diffRemovedLineNumberBg = tint(grays[3], ansiColors.red, diffAlpha)

  return {
    theme: {
      primary: ansiColors.cyan,
      secondary: ansiColors.magenta,
      accent: ansiColors.cyan,
      error: ansiColors.red,
      warning: ansiColors.yellow,
      success: ansiColors.green,
      info: ansiColors.cyan,
      text: fg,
      textMuted,
      selectedListItemText: bg,
      background: transparent,
      backgroundPanel: grays[2],
      backgroundElement: grays[3],
      backgroundMenu: grays[3],
      borderSubtle: grays[6],
      border: grays[7],
      borderActive: grays[8],
      diffAdded: ansiColors.green,
      diffRemoved: ansiColors.red,
      diffContext: grays[7],
      diffHunkHeader: grays[7],
      diffHighlightAdded: ansiColors.greenBright,
      diffHighlightRemoved: ansiColors.redBright,
      diffAddedBg,
      diffRemovedBg,
      diffContextBg: grays[1],
      diffLineNumber: grays[6],
      diffAddedLineNumberBg,
      diffRemovedLineNumberBg,
      markdownText: fg,
      markdownHeading: fg,
      markdownLink: ansiColors.blue,
      markdownLinkText: ansiColors.cyan,
      markdownCode: ansiColors.green,
      markdownBlockQuote: ansiColors.yellow,
      markdownEmph: ansiColors.yellow,
      markdownStrong: fg,
      markdownHorizontalRule: grays[7],
      markdownListItem: ansiColors.blue,
      markdownListEnumeration: ansiColors.cyan,
      markdownImage: ansiColors.blue,
      markdownImageText: ansiColors.cyan,
      markdownCodeBlock: fg,
      syntaxComment: textMuted,
      syntaxKeyword: ansiColors.magenta,
      syntaxFunction: ansiColors.blue,
      syntaxVariable: fg,
      syntaxString: ansiColors.green,
      syntaxNumber: ansiColors.yellow,
      syntaxType: ansiColors.cyan,
      syntaxOperator: ansiColors.cyan,
      syntaxPunctuation: fg,
    },
  }
}

function generateGrayScale(bg: RGBA, isDark: boolean): Record<number, RGBA> {
  const grays: Record<number, RGBA> = {}
  const bgR = bg.r * 255,
    bgG = bg.g * 255,
    bgB = bg.b * 255
  const luminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

  for (let i = 1; i <= 12; i++) {
    const factor = i / 12.0
    let newR = 0
    let newG = 0
    let newB = 0
    if (isDark) {
      if (luminance < 10) {
        const grayValue = Math.floor(factor * 0.4 * 255)
        newR = newG = newB = grayValue
      } else {
        const newLum = luminance + (255 - luminance) * factor * 0.4
        const ratio = newLum / luminance
        newR = Math.min(bgR * ratio, 255)
        newG = Math.min(bgG * ratio, 255)
        newB = Math.min(bgB * ratio, 255)
      }
    } else {
      if (luminance > 245) {
        const grayValue = Math.floor(255 - factor * 0.4 * 255)
        newR = newG = newB = grayValue
      } else {
        const newLum = luminance * (1 - factor * 0.4)
        const ratio = newLum / luminance
        newR = Math.max(bgR * ratio, 0)
        newG = Math.max(bgG * ratio, 0)
        newB = Math.max(bgB * ratio, 0)
      }
    }
    grays[i] = RGBA.fromInts(Math.floor(newR), Math.floor(newG), Math.floor(newB))
  }
  return grays
}

function generateMutedTextColor(bg: RGBA, isDark: boolean): RGBA {
  const bgLum = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) * 255
  let grayValue: number
  if (isDark) {
    grayValue = bgLum < 10 ? 180 : Math.min(Math.floor(160 + bgLum * 0.3), 200)
  } else {
    grayValue = bgLum > 245 ? 75 : Math.max(Math.floor(100 - (255 - bgLum) * 0.2), 60)
  }
  return RGBA.fromInts(grayValue, grayValue, grayValue)
}

function generateSyntax(theme: Theme) {
  return SyntaxStyle.fromTheme(getSyntaxRules(theme))
}

function generateSubtleSyntax(theme: Theme) {
  const rules = getSyntaxRules(theme)
  return SyntaxStyle.fromTheme(
    rules.map((rule) => {
      if (rule.style.foreground) {
        const fg = rule.style.foreground
        return {
          ...rule,
          style: {
            ...rule.style,
            foreground: RGBA.fromInts(
              Math.round(fg.r * 255),
              Math.round(fg.g * 255),
              Math.round(fg.b * 255),
              Math.round(theme.thinkingOpacity * 255),
            ),
          },
        }
      }
      return rule
    }),
  )
}

function getSyntaxRules(theme: Theme) {
  return [
    { scope: ["default"], style: { foreground: theme.text } },
    { scope: ["prompt"], style: { foreground: theme.accent } },
    { scope: ["extmark.file"], style: { foreground: theme.warning, bold: true } },
    { scope: ["extmark.agent"], style: { foreground: theme.secondary, bold: true } },
    { scope: ["extmark.paste"], style: { foreground: theme.background, background: theme.warning, bold: true } },
    { scope: ["comment", "comment.documentation"], style: { foreground: theme.syntaxComment, italic: true } },
    { scope: ["string", "symbol", "character.special"], style: { foreground: theme.syntaxString } },
    { scope: ["number", "boolean", "constant"], style: { foreground: theme.syntaxNumber } },
    {
      scope: [
        "keyword.return",
        "keyword.conditional",
        "keyword.repeat",
        "keyword.coroutine",
        "keyword",
        "keyword.import",
      ],
      style: { foreground: theme.syntaxKeyword, italic: true },
    },
    { scope: ["keyword.type"], style: { foreground: theme.syntaxType, bold: true, italic: true } },
    {
      scope: ["keyword.function", "function.method", "variable.member", "function", "constructor"],
      style: { foreground: theme.syntaxFunction },
    },
    {
      scope: ["operator", "keyword.operator", "punctuation.delimiter", "keyword.conditional.ternary"],
      style: { foreground: theme.syntaxOperator },
    },
    {
      scope: [
        "variable",
        "variable.parameter",
        "function.method.call",
        "function.call",
        "property",
        "syntaxPunctuation",
      ],
      style: { foreground: theme.syntaxVariable },
    },
    { scope: ["type", "module", "class"], style: { foreground: theme.syntaxType } },
  ]
}
