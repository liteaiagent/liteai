// biome-ignore-all lint/suspicious/noTemplateCurlyInString: strings are literal env-var patterns under test
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { expand, expandDeep } from "../../src/util/env-expand"

describe("expand", () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    saved.FOO = process.env.FOO
    saved.BAR = process.env.BAR
    saved.EMPTY = process.env.EMPTY
    process.env.FOO = "hello"
    process.env.BAR = "world"
    process.env.EMPTY = ""
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  test("expands ${VAR}", () => {
    expect(expand("${FOO}")).toBe("hello")
  })

  test("expands ${VAR} mid-string", () => {
    expect(expand("val=${FOO}/path")).toBe("val=hello/path")
  })

  test("expands multiple vars", () => {
    expect(expand("${FOO}-${BAR}")).toBe("hello-world")
  })

  test("uses fallback for unset var", () => {
    expect(expand("${NOPE:-fallback}")).toBe("fallback")
  })

  test("uses fallback for empty var", () => {
    expect(expand("${EMPTY:-fallback}")).toBe("fallback")
  })

  test("returns empty string for unset var without fallback", () => {
    expect(expand("${NOPE}")).toBe("")
  })

  test("ignores fallback when var is set", () => {
    expect(expand("${FOO:-ignored}")).toBe("hello")
  })

  test("returns plain strings unchanged", () => {
    expect(expand("no vars here")).toBe("no vars here")
  })
})

describe("expandDeep", () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    saved.TOKEN = process.env.TOKEN
    process.env.TOKEN = "secret"
  })

  afterEach(() => {
    if (saved.TOKEN === undefined) delete process.env.TOKEN
    else process.env.TOKEN = saved.TOKEN
  })

  test("expands strings in object", () => {
    const result = expandDeep({ key: "${TOKEN}" })
    expect(result).toEqual({ key: "secret" })
  })

  test("expands strings in arrays", () => {
    const result = expandDeep(["${TOKEN}", "plain"])
    expect(result).toEqual(["secret", "plain"])
  })

  test("expands nested objects", () => {
    const result = expandDeep({
      env: { API_KEY: "${TOKEN}" },
      command: ["cmd", "--key=${TOKEN}"],
    })
    expect(result).toEqual({
      env: { API_KEY: "secret" },
      command: ["cmd", "--key=secret"],
    })
  })

  test("preserves non-string values", () => {
    const result = expandDeep({ num: 42, bool: true, nil: null })
    expect(result).toEqual({ num: 42, bool: true, nil: null })
  })
})
