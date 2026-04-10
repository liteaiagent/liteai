import {
  InvalidSectionAttributeError,
  MissingSectionMarkerError,
  type ParsedSection,
  type ProviderTag,
  SectionOrderError,
} from "./section-registry"

export namespace SectionParser {
  const OPEN_REGEX =
    /<!--\s*section:\s*(?<name>[a-z][a-z0-9-]*)\s+scope:\s*(?<scope>[a-z0-9-]+)\s+providers:\s*(?<providers>.+?)\s*-->/i
  const CLOSE_REGEX = /<!--\s*\/section\s*-->/i

  const VALID_PROVIDER_TAGS = new Set([
    "gemini",
    "anthropic",
    "openai",
    "codex",
    "google-code-assist",
    "trinity",
    "default",
  ])

  export function parse(content: string): ParsedSection[] {
    const lines = content.split("\n")
    const sections: ParsedSection[] = []

    let currentSection: Omit<ParsedSection, "content"> | null = null
    let currentContent: string[] = []
    let order = 0
    let hasSeenVolatile = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      if (!currentSection) {
        const openMatch = OPEN_REGEX.exec(trimmed)
        if (openMatch?.groups) {
          const name = openMatch.groups.name.toLowerCase()

          const scopeStr = openMatch.groups.scope.toLowerCase()
          if (scopeStr !== "static" && scopeStr !== "volatile") {
            throw new InvalidSectionAttributeError({ message: `Invalid scope '${scopeStr}' for section '${name}'` })
          }
          const scope = scopeStr as "static" | "volatile"

          if (scope === "volatile") {
            hasSeenVolatile = true
          } else if (scope === "static" && hasSeenVolatile) {
            throw new SectionOrderError({ message: `Static section '${name}' appears after a volatile section` })
          }

          const providersStr = openMatch.groups.providers.toLowerCase().trim()
          if (providersStr === "") {
            throw new InvalidSectionAttributeError({ message: `Empty providers for section '${name}'` })
          }

          let providers: "all" | Set<ProviderTag>
          if (providersStr === "all") {
            providers = "all"
          } else {
            const parts = providersStr
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean)
            if (parts.length === 0) {
              throw new InvalidSectionAttributeError({ message: `Empty providers array for section '${name}'` })
            }
            providers = new Set()
            for (const p of parts) {
              if (!VALID_PROVIDER_TAGS.has(p)) {
                throw new InvalidSectionAttributeError({
                  message: `Invalid provider tag '${p}' for section '${name}'`,
                })
              }
              providers.add(p as ProviderTag)
            }
          }

          currentSection = {
            name,
            scope,
            providers,
            order: order++,
          }
          currentContent = []
        }
      } else {
        if (CLOSE_REGEX.test(trimmed)) {
          // Section complete
          sections.push({
            name: currentSection.name,
            scope: currentSection.scope,
            providers: currentSection.providers,
            order: currentSection.order,
            content: currentContent.join("\n").trim(),
          })
          currentSection = null
        } else {
          currentContent.push(line) // Keep original line to preserve whitespace logic
        }
      }
    }

    if (currentSection) {
      throw new MissingSectionMarkerError({ message: `Unclosed section '${currentSection.name}'` })
    }

    return sections
  }
}
