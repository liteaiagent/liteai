import { NamedError } from "@liteai/util/error"
import { z } from "zod"
import type { Provider } from "../../provider/provider"

const ErrorDataSchema = z.object({ message: z.string() })

export class SystemPromptLoadError extends NamedError.create("SystemPromptLoadError", ErrorDataSchema) {}
export class MissingSectionMarkerError extends NamedError.create("MissingSectionMarkerError", ErrorDataSchema) {}
export class SectionOrderError extends NamedError.create("SectionOrderError", ErrorDataSchema) {}
export class InvalidSectionAttributeError extends NamedError.create("InvalidSectionAttributeError", ErrorDataSchema) {}
export class DuplicateSectionError extends NamedError.create("DuplicateSectionError", ErrorDataSchema) {}
export class InvalidVolatileReasonError extends NamedError.create("InvalidVolatileReasonError", ErrorDataSchema) {}
export class UnknownSectionError extends NamedError.create("UnknownSectionError", ErrorDataSchema) {}

export type ProviderTag = "gemini" | "anthropic" | "openai" | "codex" | "google-code-assist" | "trinity" | "default"

export function resolveProviderTag(model: Provider.Model): ProviderTag {
  if (model.api.id.includes("gpt-5")) return "codex"
  if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3")) return "openai"
  if (model.providerID === "google-code-assist") return "google-code-assist"
  if (model.api.id.includes("gemini-")) return "gemini"
  if (model.api.id.includes("claude")) return "anthropic"
  if (model.api.id.toLowerCase().includes("trinity")) return "trinity"
  return "default"
}

export interface ParsedSection {
  name: string
  scope: "static" | "volatile"
  providers: "all" | Set<ProviderTag>
  content: string
  order: number
}

export interface SectionEntry {
  section: ParsedSection
  compute: (ctx?: unknown) => Promise<string>
  cached?: string
}

// biome-ignore lint/complexity/noStaticOnlyClass: intentional architectural singleton
export class SectionRegistry {
  private static readonly entries = new Map<string, SectionEntry>()
  private static readonly computeCallCount = new Map<string, number>()
  private static readonly clearCallbacks: (() => void)[] = []

  static register(section: ParsedSection, compute: (ctx?: unknown) => Promise<string>): void {
    if (SectionRegistry.entries.has(section.name)) {
      throw new DuplicateSectionError({ message: `Duplicate section: ${section.name}` })
    }
    SectionRegistry.entries.set(section.name, { section, compute })
  }

  static DANGEROUS_uncachedSystemPromptSection(
    section: ParsedSection,
    compute: (ctx?: unknown) => Promise<string>,
    reason: string,
  ): void {
    if (!reason || reason.trim() === "") {
      throw new InvalidVolatileReasonError({ message: `Reason must be provided for volatile section: ${section.name}` })
    }
    if (SectionRegistry.entries.has(section.name)) {
      throw new DuplicateSectionError({ message: `Duplicate section: ${section.name}` })
    }
    SectionRegistry.entries.set(section.name, { section, compute })
  }

  static async resolve(name: string, ctx?: unknown): Promise<string> {
    const entry = SectionRegistry.entries.get(name)
    if (!entry) {
      throw new UnknownSectionError({ message: `Unknown section: ${name}` })
    }
    if (entry.section.scope === "static") {
      if (entry.cached === undefined) {
        if (process.env.NODE_ENV === "test") {
          SectionRegistry.computeCallCount.set(name, (SectionRegistry.computeCallCount.get(name) || 0) + 1)
        }
        entry.cached = await entry.compute(ctx)
      }
      return entry.cached
    }
    // Volatile
    if (process.env.NODE_ENV === "test") {
      SectionRegistry.computeCallCount.set(name, (SectionRegistry.computeCallCount.get(name) || 0) + 1)
    }
    return entry.compute(ctx)
  }

  static clearAll(): void {
    for (const entry of SectionRegistry.entries.values()) {
      if (entry.section.scope === "static") {
        entry.cached = undefined
      }
    }
    if (process.env.NODE_ENV === "test") {
      SectionRegistry.computeCallCount.clear()
    }
    for (const callback of SectionRegistry.clearCallbacks) {
      callback()
    }
  }

  static all(): SectionEntry[] {
    return Array.from(SectionRegistry.entries.values())
  }

  static onClear(callback: () => void): void {
    SectionRegistry.clearCallbacks.push(callback)
  }

  static getComputeCallCount(name: string): number {
    return SectionRegistry.computeCallCount.get(name) || 0
  }
}
