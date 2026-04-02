// @ts-ignore
import { afterEach, describe, expect, test } from "bun:test"
import { Installation } from "../../src/installation"

const fetch0 = (globalThis as any).fetch

afterEach(() => {
  (globalThis as any).fetch = fetch0
})

describe("installation", () => {
  test("reads release version from GitHub releases", async () => {
    (globalThis as any).fetch = (async () =>
      new (globalThis as any).Response(JSON.stringify({ tag_name: "v1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as any

    expect(await Installation.latest()).toBe("1.2.3")
  })
})
