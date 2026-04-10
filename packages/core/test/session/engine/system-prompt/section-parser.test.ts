import { describe, expect, it } from "bun:test"
import { SectionParser } from "../../../../src/session/engine/section-parser"
import {
  InvalidSectionAttributeError,
  MissingSectionMarkerError,
  SectionOrderError,
} from "../../../../src/session/engine/section-registry"

describe("SectionParser", () => {
  it("should parse a valid section with all providers", () => {
    const raw = `
Some ignored text
<!-- section: identity scope: static providers: all -->
Hello World
This is multiple lines.
<!-- /section -->
More ignored text
    `
    const sections = SectionParser.parse(raw)
    expect(sections).toHaveLength(1)
    expect(sections[0].name).toBe("identity")
    expect(sections[0].scope).toBe("static")
    expect(sections[0].providers).toBe("all")
    expect(sections[0].content).toBe("Hello World\nThis is multiple lines.")
    expect(sections[0].order).toBe(0)
  })

  it("should parse comma-separated provider tags", () => {
    const raw = `
<!-- section: rules scope: static providers: gemini, openai,    anthropic -->
My rules here
<!-- /section -->
    `
    const sections = SectionParser.parse(raw)
    expect(sections).toHaveLength(1)
    expect(sections[0].providers).toBeInstanceOf(Set)
    const providers = sections[0].providers as Set<string>
    expect(providers.has("gemini")).toBeTrue()
    expect(providers.has("openai")).toBeTrue()
    expect(providers.has("anthropic")).toBeTrue()
    expect(providers.size).toBe(3)
  })

  it("should throw MissingSectionMarkerError for unclosed section", () => {
    const raw = `
<!-- section: identity scope: static providers: all -->
Unclosed section
    `
    expect(() => SectionParser.parse(raw)).toThrow(MissingSectionMarkerError)
  })

  it("should throw SectionOrderError when static section appears after volatile", () => {
    const raw = `
<!-- section: one scope: volatile providers: all -->
content
<!-- /section -->
<!-- section: two scope: static providers: all -->
content
<!-- /section -->
    `
    expect(() => SectionParser.parse(raw)).toThrow(SectionOrderError)
  })

  it("should throw InvalidSectionAttributeError for invalid scope", () => {
    const raw = `
<!-- section: test scope: invalidscope providers: all -->
content
<!-- /section -->
    `
    expect(() => SectionParser.parse(raw)).toThrow(InvalidSectionAttributeError)
  })

  it("should throw InvalidSectionAttributeError for invalid provider tag", () => {
    const raw = `
<!-- section: test scope: static providers: gemini, fake-provider -->
content
<!-- /section -->
    `
    expect(() => SectionParser.parse(raw)).toThrow(InvalidSectionAttributeError)
  })

  it("should parse a multi-section document correctly", () => {
    const raw = `
Header text should be ignored.
<!-- section: first scope: static providers: all -->
First content
<!-- /section -->
In-between text ignored.
<!-- section: second scope: static providers: gemini -->
Second content
<!-- /section -->
<!-- section: third scope: volatile providers: all -->
Third content
<!-- /section -->
    `
    const sections = SectionParser.parse(raw)
    expect(sections).toHaveLength(3)
    expect(sections[0].name).toBe("first")
    expect(sections[1].name).toBe("second")
    expect(sections[2].name).toBe("third")
    expect(sections[2].scope).toBe("volatile")
  })
})
