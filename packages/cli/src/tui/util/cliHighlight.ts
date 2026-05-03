import chalk from "chalk"
import hljs from "highlight.js/lib/core"
import * as parse5 from "parse5"
import { adapter as treeAdapter } from "parse5-htmlparser2-tree-adapter"

const defaultTheme: Record<string, (text: string) => string> = {
  keyword: chalk.blue,
  built_in: chalk.cyan,
  type: chalk.cyan.dim,
  literal: chalk.blue,
  number: chalk.green,
  regexp: chalk.red,
  string: chalk.red,
  subst: chalk.reset,
  symbol: chalk.reset,
  class: chalk.blue,
  function: chalk.yellow,
  title: chalk.blue,
  params: chalk.reset,
  comment: chalk.green,
  doctag: chalk.green,
  meta: chalk.grey,
  "meta-keyword": chalk.grey,
  "meta-string": chalk.grey,
  section: chalk.cyan,
  tag: chalk.grey,
  name: chalk.blue,
  "builtin-name": chalk.reset,
  attr: chalk.cyan,
  attribute: chalk.reset,
  variable: chalk.reset,
  bullet: chalk.reset,
  code: chalk.reset,
  emphasis: chalk.italic,
  strong: chalk.bold,
  formula: chalk.reset,
  link: chalk.underline,
  quote: chalk.reset,
  "selector-tag": chalk.reset,
  "selector-id": chalk.reset,
  "selector-class": chalk.reset,
  "selector-attr": chalk.reset,
  "selector-pseudo": chalk.reset,
  "template-tag": chalk.reset,
  "template-variable": chalk.reset,
  addition: chalk.green,
  deletion: chalk.red,
}

// biome-ignore lint/suspicious/noExplicitAny: generic AST node
function colorizeNode(node: any, context?: string): string {
  if (node.type === "text") {
    return node.data
  }
  if (node.type === "tag") {
    let hljsClass = context
    if (node.attribs?.class) {
      const match = /hljs-(\w+)/.exec(node.attribs.class)
      if (match) hljsClass = match[1]
    }
    // biome-ignore lint/suspicious/noExplicitAny: generic AST node
    const nodeData = (node.childNodes || []).map((n: any) => colorizeNode(n, hljsClass)).join("")
    if (hljsClass && defaultTheme[hljsClass]) {
      return defaultTheme[hljsClass](nodeData)
    }
    return nodeData
  }
  throw new Error(`Invalid node type ${node.type}`)
}

function colorize(code: string): string {
  const fragment = parse5.parseFragment(code, {
    treeAdapter,
  })
  // biome-ignore lint/suspicious/noExplicitAny: generic AST node
  return (fragment.childNodes || []).map((n: any) => colorizeNode(n)).join("")
}

export type CliHighlight = {
  highlight: (code: string, options: { language: string }) => string
  supportsLanguage: (lang: string) => boolean
}

// biome-ignore lint/suspicious/noExplicitAny: dynamic import module
const LANGUAGE_MAP: Record<string, () => Promise<any>> = {
  typescript: () => import("highlight.js/lib/languages/typescript"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  python: () => import("highlight.js/lib/languages/python"),
  bash: () => import("highlight.js/lib/languages/bash"),
  json: () => import("highlight.js/lib/languages/json"),
  css: () => import("highlight.js/lib/languages/css"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  diff: () => import("highlight.js/lib/languages/diff"),
  rust: () => import("highlight.js/lib/languages/rust"),
  go: () => import("highlight.js/lib/languages/go"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  shell: () => import("highlight.js/lib/languages/shell"),
  sql: () => import("highlight.js/lib/languages/sql"),
}

const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "bash",
  yml: "yaml",
  html: "xml",
  rs: "rust",
  golang: "go",
}

export function createCliHighlight(): CliHighlight {
  return {
    supportsLanguage: (lang: string) => {
      const canonical = ALIASES[lang] || lang
      return !!LANGUAGE_MAP[canonical] || !!hljs.getLanguage(lang)
    },
    highlight: (code: string, options: { language: string }) => {
      let html = code
      if (options.language && hljs.getLanguage(options.language)) {
        html = hljs.highlight(code, { language: options.language }).value
      } else {
        html = hljs.highlightAuto(code).value
      }
      return colorize(html)
    },
  }
}

let cliHighlightInstance: CliHighlight | null = null

export async function getCliHighlightPromise(markdownText?: string): Promise<CliHighlight> {
  if (markdownText) {
    const langs = Array.from(markdownText.matchAll(/```([\w-]+)/g)).map((m) => m[1])
    const uniqueLangs = Array.from(new Set(langs))
    const loads = uniqueLangs.map((lang) => {
      const canonical = ALIASES[lang] || lang
      if (LANGUAGE_MAP[canonical] && !hljs.getLanguage(canonical)) {
        return LANGUAGE_MAP[canonical]().then((mod) => {
          hljs.registerLanguage(canonical, mod.default)
        })
      }
      return Promise.resolve()
    })
    await Promise.all(loads)
  }
  if (!cliHighlightInstance) {
    cliHighlightInstance = createCliHighlight()
  }
  return cliHighlightInstance
}
