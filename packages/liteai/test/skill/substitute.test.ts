import { describe, expect, test } from "bun:test"
import { Substitute } from "../../src/skill/substitute"

describe("Substitute.apply", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal ${} for substitution testing
  test("replaces ${LITEAI_SESSION_ID}", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
    const result = Substitute.apply("session: ${LITEAI_SESSION_ID}", { sessionID: "abc123" })
    expect(result).toBe("session: abc123")
  })

  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal ${} for substitution testing
  test("replaces ${CLAUDE_SESSION_ID}", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
    const result = Substitute.apply("session: ${CLAUDE_SESSION_ID}", { sessionID: "abc123" })
    expect(result).toBe("session: abc123")
  })

  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal ${} for substitution testing
  test("replaces ${LITEAI_SKILL_DIR}", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
    const result = Substitute.apply("dir: ${LITEAI_SKILL_DIR}", { dir: "/path/to/skill" })
    expect(result).toBe("dir: /path/to/skill")
  })

  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal ${} for substitution testing
  test("replaces ${CLAUDE_SKILL_DIR}", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
    const result = Substitute.apply("dir: ${CLAUDE_SKILL_DIR}", { dir: "/path/to/skill" })
    expect(result).toBe("dir: /path/to/skill")
  })

  test("replaces multiple vars in one string", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
    const result = Substitute.apply("session=${LITEAI_SESSION_ID} dir=${LITEAI_SKILL_DIR}", {
      sessionID: "s1",
      dir: "/d",
    })
    expect(result).toBe("session=s1 dir=/d")
  })

  test("replaces $ARGUMENTS", () => {
    const result = Substitute.apply("args: $ARGUMENTS", { arguments: "foo bar" })
    expect(result).toBe("args: foo bar")
  })

  test("replaces positional $1 $2", () => {
    const result = Substitute.apply("first=$1 second=$2", { arguments: "hello world" })
    expect(result).toBe("first=hello second=world")
  })

  test("positional args handle quoted strings", () => {
    const result = Substitute.apply("$1 $2", { arguments: '"hello world" bar' })
    expect(result).toBe("hello world bar")
  })

  test("missing positional args become empty", () => {
    const result = Substitute.apply("$1 $2 $3", { arguments: "only" })
    expect(result).toBe("only  ")
  })

  test("skips $ARGUMENTS when arguments not provided", () => {
    const result = Substitute.apply("keep $ARGUMENTS intact", {})
    expect(result).toBe("keep $ARGUMENTS intact")
  })

  test("missing vars become empty string", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
    const result = Substitute.apply("${LITEAI_SESSION_ID}", {})
    expect(result).toBe("")
  })

  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal ${} for substitution testing
  test("leaves unrecognized ${} untouched", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
    const result = Substitute.apply("${OTHER_VAR}", {})
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
    expect(result).toBe("${OTHER_VAR}")
  })
})

describe("Substitute.shell", () => {
  test("executes and replaces !`command` patterns", async () => {
    const result = await Substitute.shell("output: !`echo hello`")
    expect(result.trim()).toBe("output: hello")
  })

  test("returns content unchanged when no shell patterns", async () => {
    const content = "no shell commands here"
    const result = await Substitute.shell(content)
    expect(result).toBe(content)
  })

  test("handles failed commands gracefully", async () => {
    const result = await Substitute.shell("result: !`nonexistent_cmd_xyz_12345`")
    expect(result).toContain("result:")
  })
})
