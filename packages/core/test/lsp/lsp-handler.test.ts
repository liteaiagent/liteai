import { describe, expect, test } from "bun:test"
import { buildCompletionPrompt } from "../../src/lsp/lsp-handler"

describe("buildCompletionPrompt", () => {
  test("includes language, file, prefix, and suffix", () => {
    const prompt = buildCompletionPrompt({
      prefix: "function hello() {\n  return ",
      suffix: "\n}\n\nconsole.log(hello())",
      languageId: "typescript",
      fileUri: "file:///path/to/file.ts",
    })

    expect(prompt).toContain("Language: typescript")
    expect(prompt).toContain("File: file:///path/to/file.ts")
    expect(prompt).toContain("<prefix>")
    expect(prompt).toContain("function hello() {")
    expect(prompt).toContain("return ")
    expect(prompt).toContain("<suffix>")
    expect(prompt).toContain("console.log(hello())")
  })

  test("trims prefix to last 100 lines", () => {
    // Create a prefix with 150 lines
    const lines = Array.from({ length: 150 }, (_, i) => `line ${i}`)
    const prefix = lines.join("\n")

    const prompt = buildCompletionPrompt({
      prefix,
      suffix: "// after",
      languageId: "javascript",
      fileUri: "file:///test.js",
    })

    // Should NOT contain line 0-49 (too old)
    expect(prompt).not.toContain("line 0\n")
    expect(prompt).not.toContain("line 49\n")

    // SHOULD contain lines 50-149 (last 100)
    expect(prompt).toContain("line 50")
    expect(prompt).toContain("line 149")
  })

  test("trims suffix to first 20 lines", () => {
    // Create a suffix with 50 lines
    const lines = Array.from({ length: 50 }, (_, i) => `suffix line ${i}`)
    const suffix = lines.join("\n")

    const prompt = buildCompletionPrompt({
      prefix: "const x = ",
      suffix,
      languageId: "javascript",
      fileUri: "file:///test.js",
    })

    // SHOULD contain first 20 lines
    expect(prompt).toContain("suffix line 0")
    expect(prompt).toContain("suffix line 19")

    // Should NOT contain lines 20+
    expect(prompt).not.toContain("suffix line 20")
    expect(prompt).not.toContain("suffix line 49")
  })

  test("includes instruction to output only completion text", () => {
    const prompt = buildCompletionPrompt({
      prefix: "const x = ",
      suffix: "",
      languageId: "python",
      fileUri: "file:///test.py",
    })

    expect(prompt).toContain("Output ONLY the completion text")
    expect(prompt).toContain("No explanation")
  })

  test("handles empty prefix and suffix", () => {
    const prompt = buildCompletionPrompt({
      prefix: "",
      suffix: "",
      languageId: "plaintext",
      fileUri: "file:///empty.txt",
    })

    expect(prompt).toContain("<prefix>")
    expect(prompt).toContain("</prefix>")
    expect(prompt).toContain("<suffix>")
    expect(prompt).toContain("</suffix>")
    expect(prompt).toContain("Language: plaintext")
  })
})
