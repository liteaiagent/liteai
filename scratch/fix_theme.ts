import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const file = join(process.cwd(), 'packages/cli/src/tui/context/theme.tsx');
let content = readFileSync(file, 'utf8');

// 1. Imports
content = content.replace(
  'import { RGBA, SyntaxStyle } from "@opentui/core"',
  'import * as color from "../util/color"\nimport { parseHex, fromInts } from "../util/color"\n\nexport type TextStyle = {\n  foreground?: string\n  background?: string\n  bold?: boolean\n  italic?: boolean\n}\n\nexport type SyntaxRule = {\n  scope: string[]\n  style: TextStyle\n}\n\nexport class SyntaxStyle {\n  constructor(public rules: SyntaxRule[]) {}\n  static fromTheme(rules: SyntaxRule[]) {\n    return new SyntaxStyle(rules)\n  }\n}'
);

// 2. Replace RGBA with string in ThemeColors
content = content.replace(/(?<=^\s+[\w]+:\s)RGBA/gm, 'string');

// 3. selectedForeground
content = content.replace(
  /export function selectedForeground\(theme: Theme, bg\?: RGBA\): RGBA \{([\s\S]*?)return theme\.background\n\}/,
  `export function selectedForeground(theme: Theme, bg?: string): string {
  if (theme._hasSelectedListItemText) {
    return theme.selectedListItemText
  }

  const { a } = parseHex(theme.background)
  if (a === 0) {
    const targetColor = bg ?? theme.primary
    const { r, g, b } = parseHex(targetColor)
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance > 127.5 ? "#000000" : "#ffffff"
  }

  return theme.background
}`
);

// 4. ColorValue
content = content.replace(/type ColorValue = HexColor \| RefName \| Variant \| RGBA/, 'type ColorValue = HexColor | RefName | Variant | string');

// 5. resolveColor
content = content.replace(
  /function resolveColor\(c: ColorValue\): RGBA \{[\s\S]*?return resolveColor\(c\[mode\]\)\n  \}/,
  `function resolveColor(c: ColorValue): string {
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return fromInts(0, 0, 0, 0)
      if (c.startsWith("#")) return c
      if (defs[c] != null) return resolveColor(defs[c])
      const ref = theme.theme[c as keyof ThemeColors]
      if (ref !== undefined) return resolveColor(ref)
      throw new Error(\`Color reference "\${c}" not found in defs or theme\`)
    }
    if (typeof c === "number") return ansiToHex(c)
    return resolveColor(c[mode])
  }`
);

// 6. Selected list item defaults
content = content.replace(/RGBA\.fromInts\(0, 0, 0\)/g, 'fromInts(0, 0, 0)');

// 7. ansiToRgba -> ansiToHex
content = content.replace(/function ansiToRgba\(code: number\): RGBA/g, 'function ansiToHex(code: number): string');
content = content.replace(/ansiToRgba/g, 'ansiToHex');
content = content.replace(/RGBA\.fromHex\((.*?)\)/g, '$1'); // since it returns string now
content = content.replace(/RGBA\.fromInts\((.*?)\)/g, 'fromInts($1)');

// 8. tint function
content = content.replace(
  /export function tint\(base: RGBA, overlay: RGBA, alpha: number\): RGBA \{[\s\S]*?return RGBA\.fromInts\(Math\.round\(r \* 255\), Math\.round\(g \* 255\), Math\.round\(b \* 255\)\)\n\}/,
  `export function tint(base: string, overlay: string, alpha: number): string {
  const bColors = parseHex(base)
  const oColors = parseHex(overlay)
  const r = bColors.r + (oColors.r - bColors.r) * alpha
  const g = bColors.g + (oColors.g - bColors.g) * alpha
  const b = bColors.b + (oColors.b - bColors.b) * alpha
  return fromInts(Math.round(r), Math.round(g), Math.round(b))
}`
);

// 9. generateSystem
content = content.replace(
  /function generateSystem\(colors: InkTerminalColors, mode: "dark" \| "light"\): ThemeJson \{[\s\S]*?const bg = RGBA\.fromHex\(colors\.defaultBackground \?\? colors\.palette\[0\] \?\? "#000000"\)\n\s+const fg = RGBA\.fromHex\(colors\.defaultForeground \?\? colors\.palette\[7\] \?\? "#c0c0c0"\)\n\s+const transparent = RGBA\.fromInts\(0, 0, 0, 0\)/,
  `function generateSystem(colors: InkTerminalColors, mode: "dark" | "light"): ThemeJson {
  const bg = colors.defaultBackground ?? colors.palette[0] ?? "#000000"
  const fg = colors.defaultForeground ?? colors.palette[7] ?? "#c0c0c0"
  const transparent = fromInts(0, 0, 0, 0)`
);

// 10. generateGrayScale
content = content.replace(
  /function generateGrayScale\(bg: RGBA, isDark: boolean\): Record<number, RGBA> \{[\s\S]*?const bgR = bg\.r \* 255,\n\s+bgG = bg\.g \* 255,\n\s+bgB = bg\.b \* 255\n\s+const luminance = 0\.299 \* bgR \+ 0\.587 \* bgG \+ 0\.114 \* bgB/,
  `function generateGrayScale(bg: string, isDark: boolean): Record<number, string> {
  const grays: Record<number, string> = {}
  const { r: bgR, g: bgG, b: bgB } = parseHex(bg)
  const luminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB`
);

content = content.replace(/grays\[i\] = RGBA\.fromInts\(/g, 'grays[i] = fromInts(');

// 11. generateMutedTextColor
content = content.replace(
  /function generateMutedTextColor\(bg: RGBA, isDark: boolean\): RGBA \{[\s\S]*?const bgLum = \(0\.299 \* bg\.r \+ 0\.587 \* bg\.g \+ 0\.114 \* bg\.b\) \* 255/,
  `function generateMutedTextColor(bg: string, isDark: boolean): string {
  const { r, g, b } = parseHex(bg)
  const bgLum = (0.299 * r + 0.587 * g + 0.114 * b)`
);
content = content.replace(/return RGBA\.fromInts\(grayValue, grayValue, grayValue\)/g, 'return fromInts(grayValue, grayValue, grayValue)');

// 12. generateSubtleSyntax
content = content.replace(
  /foreground: RGBA\.fromInts\([\s\S]*?Math\.round\(theme\.thinkingOpacity \* 255\),[\s\S]*?\),/,
  `foreground: color.withAlpha(fg, theme.thinkingOpacity),`
);

writeFileSync(file, content);
console.log('theme.tsx refactored');
