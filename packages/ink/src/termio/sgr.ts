/**
 * SGR (Select Graphic Rendition) Parser
 *
 * Parses SGR parameters and applies them to a TextStyle.
 * Handles both semicolon (;) and colon (:) separated parameters.
 */

import type { NamedColor, TextStyle, UnderlineStyle } from './types.js'
import { defaultStyle } from './types.js'

const NAMED_COLORS: NamedColor[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
]

const UNDERLINE_STYLES: UnderlineStyle[] = ['none', 'single', 'double', 'curly', 'dotted', 'dashed']

type Param = { value: number | null; subparams: number[]; colon: boolean }

function parseParams(str: string): Param[] {
  if (str === '') return [{ value: 0, subparams: [], colon: false }]

  const result: Param[] = []
  let current: Param = { value: null, subparams: [], colon: false }
  let num = ''
  let inSub = false

  for (let i = 0; i <= str.length; i++) {
    const c = str[i]
    if (c === ';' || c === undefined) {
      const n = num === '' ? null : parseInt(num, 10)
      if (inSub) {
        if (n !== null) current.subparams.push(n)
      } else {
        current.value = n
      }
      result.push(current)
      current = { value: null, subparams: [], colon: false }
      num = ''
      inSub = false
    } else if (c === ':') {
      const n = num === '' ? null : parseInt(num, 10)
      if (!inSub) {
        current.value = n
        current.colon = true
        inSub = true
      } else {
        if (n !== null) current.subparams.push(n)
      }
      num = ''
    } else if (c >= '0' && c <= '9') {
      num += c
    }
  }
  return result
}

function parseExtendedColor(
  params: Param[],
  idx: number,
): { r: number; g: number; b: number } | { index: number } | null {
  const p = params[idx]
  if (!p) return null

  if (p.colon && p.subparams.length >= 1) {
    if (p.subparams[0] === 5 && p.subparams.length >= 2) {
      return { index: p.subparams[1] ?? 0 }
    }
    if (p.subparams[0] === 2 && p.subparams.length >= 4) {
      const off = p.subparams.length >= 5 ? 1 : 0
      return {
        r: p.subparams[1 + off] ?? 0,
        g: p.subparams[2 + off] ?? 0,
        b: p.subparams[3 + off] ?? 0,
      }
    }
  }

  const next = params[idx + 1]
  if (!next) return null
  if (next.value === 5 && params[idx + 2]?.value !== null && params[idx + 2]?.value !== undefined) {
    return { index: params[idx + 2]?.value ?? 0 }
  }
  if (next.value === 2) {
    const r = params[idx + 2]?.value
    const g = params[idx + 3]?.value
    const b = params[idx + 4]?.value
    if (r !== null && r !== undefined && g !== null && g !== undefined && b !== null && b !== undefined) {
      return { r, g, b }
    }
  }
  return null
}

export function applySGR(paramStr: string, style: TextStyle): TextStyle {
  const params = parseParams(paramStr)
  let s = { ...style }
  let i = 0

  while (i < params.length) {
    const p = params[i]
    if (!p) break
    const code = p.value ?? 0

    if (code === 0) {
      s = defaultStyle()
      i++
      continue
    }
    if (code === 1) {
      s.bold = true
      i++
      continue
    }
    if (code === 2) {
      s.dim = true
      i++
      continue
    }
    if (code === 3) {
      s.italic = true
      i++
      continue
    }
    if (code === 4) {
      s.underline = p.colon ? (UNDERLINE_STYLES[p.subparams[0] ?? 0] ?? 'single') : 'single'
      i++
      continue
    }
    if (code === 5 || code === 6) {
      s.blink = true
      i++
      continue
    }
    if (code === 7) {
      s.inverse = true
      i++
      continue
    }
    if (code === 8) {
      s.hidden = true
      i++
      continue
    }
    if (code === 9) {
      s.strikethrough = true
      i++
      continue
    }
    if (code === 21) {
      s.underline = 'double'
      i++
      continue
    }
    if (code === 22) {
      s.bold = false
      s.dim = false
      i++
      continue
    }
    if (code === 23) {
      s.italic = false
      i++
      continue
    }
    if (code === 24) {
      s.underline = 'none'
      i++
      continue
    }
    if (code === 25) {
      s.blink = false
      i++
      continue
    }
    if (code === 27) {
      s.inverse = false
      i++
      continue
    }
    if (code === 28) {
      s.hidden = false
      i++
      continue
    }
    if (code === 29) {
      s.strikethrough = false
      i++
      continue
    }
    if (code === 53) {
      s.overline = true
      i++
      continue
    }
    if (code === 55) {
      s.overline = false
      i++
      continue
    }

    if (code >= 30 && code <= 37) {
      s.fg = { type: 'named', name: NAMED_COLORS[code - 30] ?? 'white' }
      i++
      continue
    }
    if (code === 39) {
      s.fg = { type: 'default' }
      i++
      continue
    }
    if (code >= 40 && code <= 47) {
      s.bg = { type: 'named', name: NAMED_COLORS[code - 40] ?? 'black' }
      i++
      continue
    }
    if (code === 49) {
      s.bg = { type: 'default' }
      i++
      continue
    }
    if (code >= 90 && code <= 97) {
      s.fg = { type: 'named', name: NAMED_COLORS[code - 90 + 8] ?? 'white' }
      i++
      continue
    }
    if (code >= 100 && code <= 107) {
      s.bg = { type: 'named', name: NAMED_COLORS[code - 100 + 8] ?? 'black' }
      i++
      continue
    }

    if (code === 38) {
      const c = parseExtendedColor(params, i)
      if (c) {
        s.fg = 'index' in c ? { type: 'indexed', index: c.index } : { type: 'rgb', ...c }
        i += p.colon ? 1 : 'index' in c ? 3 : 5
        continue
      }
    }
    if (code === 48) {
      const c = parseExtendedColor(params, i)
      if (c) {
        s.bg = 'index' in c ? { type: 'indexed', index: c.index } : { type: 'rgb', ...c }
        i += p.colon ? 1 : 'index' in c ? 3 : 5
        continue
      }
    }
    if (code === 58) {
      const c = parseExtendedColor(params, i)
      if (c) {
        s.underlineColor = 'index' in c ? { type: 'indexed', index: c.index } : { type: 'rgb', ...c }
        i += p.colon ? 1 : 'index' in c ? 3 : 5
        continue
      }
    }
    if (code === 59) {
      s.underlineColor = { type: 'default' }
      i++
      continue
    }

    i++
  }
  return s
}
