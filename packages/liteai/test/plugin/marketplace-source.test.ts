import { describe, expect, test } from "bun:test"
import { detect, name } from "../../src/plugin/marketplace-source"

// ---------------------------------------------------------------------------
// Source detection
// ---------------------------------------------------------------------------
describe("marketplace-source.detect", () => {
  test("detects GitHub shorthand", () => {
    const result = detect("owner/repo")
    expect(result).toEqual({ source: "github", repo: "owner/repo" })
  })

  test("detects GitHub with dots in repo name", () => {
    const result = detect("owner/my.repo")
    expect(result).toEqual({ source: "github", repo: "owner/my.repo" })
  })

  test("detects GitHub with hyphens and underscores", () => {
    const result = detect("my-org/my_repo")
    expect(result).toEqual({ source: "github", repo: "my-org/my_repo" })
  })

  test("detects git URL with .git suffix", () => {
    const result = detect("https://github.com/owner/repo.git")
    expect(result).toEqual({ source: "url", url: "https://github.com/owner/repo.git" })
  })

  test("detects git@ SSH URL", () => {
    const result = detect("git@github.com:owner/repo.git")
    expect(result).toEqual({ source: "url", url: "git@github.com:owner/repo.git" })
  })

  test("detects ssh:// URL", () => {
    const result = detect("ssh://git@github.com/owner/repo.git")
    expect(result).toEqual({ source: "url", url: "ssh://git@github.com/owner/repo.git" })
  })

  test("detects remote JSON URL", () => {
    const result = detect("https://example.com/marketplace.json")
    expect(result).toEqual({ source: "url", url: "https://example.com/marketplace.json" })
  })

  test("detects remote non-.git HTTP URL", () => {
    const result = detect("https://example.com/plugins")
    expect(result).toEqual({ source: "url", url: "https://example.com/plugins" })
  })

  test("detects local path (relative)", () => {
    const result = detect("./my-marketplace")
    expect(result).toBe("./my-marketplace")
  })

  test("detects local path (absolute)", () => {
    const result = detect("/opt/marketplaces/test")
    expect(result).toBe("/opt/marketplaces/test")
  })

  test("detects local path (simple name)", () => {
    // A bare name with no slash is not a GitHub shorthand
    const result = detect("my-marketplace")
    expect(result).toBe("my-marketplace")
  })
})

// ---------------------------------------------------------------------------
// Source name derivation
// ---------------------------------------------------------------------------
describe("marketplace-source.name", () => {
  test("derives name from GitHub source", () => {
    const result = name({ source: "github", repo: "owner/marketplace" })
    expect(result).toBe("owner-marketplace")
  })

  test("derives name from URL source", () => {
    const result = name({ source: "url", url: "https://gitlab.com/org/market.git" })
    expect(result).toBe("org-market")
  })

  test("derives name from local path", () => {
    const result = name("./my-local-market")
    // path.basename of "./my-local-market" is "my-local-market"
    expect(result).toBe("my-local-market")
  })

  test("derives name from remote URL without .git", () => {
    const result = name({ source: "url", url: "https://example.com/plugins/catalog" })
    expect(result).toBe("plugins-catalog")
  })
})
