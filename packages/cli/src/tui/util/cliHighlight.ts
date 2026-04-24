import * as cliHighlight from "cli-highlight"
import hljs from "highlight.js"

export type CliHighlight = {
  highlight: typeof cliHighlight.highlight
  supportsLanguage: (lang: string) => boolean
}

export function createCliHighlight(): CliHighlight {
  return {
    supportsLanguage: (lang: string) => {
      return !!hljs.getLanguage(lang)
    },
    highlight: cliHighlight.highlight,
  }
}

let cachedPromise: Promise<CliHighlight> | null = null

export function getCliHighlightPromise(): Promise<CliHighlight> {
  if (!cachedPromise) {
    cachedPromise = Promise.resolve(createCliHighlight())
  }
  return cachedPromise
}
