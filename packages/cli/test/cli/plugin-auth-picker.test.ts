import { describe, expect, test } from "bun:test"
import type { AuthProvider } from "liteai/auth/provider"
import { resolvePluginProviders } from "../../src/cli/cmd/providers"

function provider(id: string): [string, AuthProvider] {
  return [
    id,
    {
      provider: id,
      auth: {
        methods: [],
      },
    },
  ]
}

describe("resolvePluginProviders", () => {
  test("returns plugin providers not in models.dev", () => {
    const result = resolvePluginProviders({
      providers: new Map([provider("portkey")]),
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("skips providers already in models.dev", () => {
    const result = resolvePluginProviders({
      providers: new Map([provider("anthropic")]),
      existingProviders: { anthropic: {} },
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("deduplicates across providers", () => {
    const result = resolvePluginProviders({
      providers: new Map([provider("portkey")]),
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("respects disabled_providers", () => {
    const result = resolvePluginProviders({
      providers: new Map([provider("portkey")]),
      existingProviders: {},
      disabled: new Set(["portkey"]),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("respects enabled_providers when provider is absent", () => {
    const result = resolvePluginProviders({
      providers: new Map([provider("portkey")]),
      existingProviders: {},
      disabled: new Set(),
      enabled: new Set(["anthropic"]),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("includes provider when in enabled set", () => {
    const result = resolvePluginProviders({
      providers: new Map([provider("portkey")]),
      existingProviders: {},
      disabled: new Set(),
      enabled: new Set(["portkey"]),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("resolves name from providerNames", () => {
    const result = resolvePluginProviders({
      providers: new Map([provider("portkey")]),
      existingProviders: {},
      disabled: new Set(),
      providerNames: { portkey: "Portkey AI" },
    })
    expect(result).toEqual([{ id: "portkey", name: "Portkey AI" }])
  })

  test("falls back to id when no name configured", () => {
    const result = resolvePluginProviders({
      providers: new Map([provider("portkey")]),
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("returns empty for no providers", () => {
    const result = resolvePluginProviders({
      providers: new Map(),
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([])
  })
})
