# API Contracts: Unified System Prompt Resolution

**Feature**: `001-unified-system-prompt`  
**Phase**: 1 — Design & Contracts  
**Date**: 2026-04-10

---

## Overview

This document defines the TypeScript public API surface exposed by the unified system prompt resolver. These contracts replace `Bundled.systemPrompt(name)` and `SystemPrompt.provider()`.

---

## Module: `SectionRegistry`

**File**: `packages/core/src/session/engine/section-registry.ts`

```typescript
/**
 * Global, process-scoped registry of all system prompt sections.
 * All sections are parsed from a single `system.md` file via `SectionParser`.
 *
 * Cache semantics:
 * - static sections: memoized globally; compute() called once per process lifetime
 * - volatile sections: compute() called on every resolve() invocation
 */
export class SectionRegistry {
  /**
   * Register a static (lazily-memoized) section.
   *
   * @throws {DuplicateSectionError} if `section.name` is already registered
   */
  static register(
    section: ParsedSection,
    compute: () => Promise<string>,
  ): void

  /**
   * Register a volatile section that is re-computed on every resolution.
   * The `reason` parameter is mandatory and must be non-empty; it documents
   * why caching is unsafe for this section (for audit trail purposes).
   *
   * @throws {DuplicateSectionError} if `section.name` is already registered
   * @throws {InvalidVolatileReasonError} if `reason` is empty or whitespace-only
   */
  static DANGEROUS_uncachedSystemPromptSection(
    section: ParsedSection,
    compute: () => Promise<string>,
    reason: string,
  ): void

  /**
   * Resolve a section by name.
   * - Static: returns cached value (or computes and caches on first call).
   * - Volatile: always re-invokes compute().
   *
   * @throws {UnknownSectionError} if name is not registered
   */
  static resolve(name: string): Promise<string>

  /**
   * Clear all cached values.
   * Static sections revert to UNREGISTERED state — their compute() will be
   * called again on next resolve(). Volatile sections are unaffected.
   *
   * Use in tests and on hot-reload signals.
   */
  static clearAll(): void

  /**
   * Return all registered section entries in registration order.
   * Used by `resolveSystemPromptSections()` to assemble the final array.
   */
  static all(): ReadonlyArray<SectionEntry>
}
```

---

## Module: `SectionParser`

**File**: `packages/core/src/session/engine/section-parser.ts`

```typescript
/**
 * Parses raw `system.md` content into an ordered array of `ParsedSection` objects.
 * Validates structural integrity and scope ordering constraints at parse time.
 */
export namespace SectionParser {
  /**
   * Parse raw system.md file content.
   *
   * @param rawContent Full string content of system.md
   * @returns Ordered array of ParsedSection (file order preserved)
   *
   * @throws {SystemPromptLoadError}       if rawContent is empty
   * @throws {MissingSectionMarkerError}   if an open marker has no matching <!-- /section -->
   * @throws {SectionOrderError}           if a static section appears after a volatile section
   * @throws {InvalidSectionAttributeError} if name/scope/providers values are invalid
   */
  function parse(rawContent: string): ParsedSection[]
}
```

---

## Function: `resolveSystemPromptSections`

**File**: `packages/core/src/session/engine/system.ts` (replaces `SystemPrompt.provider()`)

```typescript
/**
 * Resolves all registered system prompt sections for the given provider model.
 *
 * Resolution algorithm:
 * 1. Resolve `model` → `ProviderTag` (deterministic, priority-ordered)
 * 2. Filter registry to sections matching tag (scope=all | tag ∈ section.providers)
 * 3. Static sections: return cached strings (synchronous map lookups)
 * 4. Volatile sections: `await Promise.all(compute())` (parallel async resolution)
 * 5. Return { parts: [...static, ...volatile], boundary: static.length }
 *
 * @param model The active `Provider.Model` for which the prompt is assembled
 * @returns SystemPromptAssembly with ordered string[] and boundary index
 *
 * @throws {SystemPromptLoadError} if system.md hasn't been loaded and is unreadable
 */
export async function resolveSystemPromptSections(
  model: Provider.Model,
): Promise<SystemPromptAssembly>

```

---

## Boundary Consumer Contract

> **liteai_cli_mvp divergence note**: liteai_cli_mvp uses `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` as a sentinel
> string (`'__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'`) embedded in the `string[]` and consumed via
> `findIndex()` in `api.ts`. LiteAI uses `boundary` as a **numeric value returned per-call**
> inside `{ parts, boundary }`. This is an intentional architectural divergence:
> - Sentinel strings require per-provider stripping logic incompatible with a multi-provider
>   transport layer (Gemini, Anthropic, OpenAI each have different system message shapes)
> - A module-level mutable `let` creates multi-tenant data races in a concurrent server
> - The return-value approach is session-isolated by construction

**Consumer pattern** (the only correct usage):

```typescript
const { parts, boundary } = await resolveSystemPromptSections(model)
const staticParts   = parts.slice(0, boundary)  // cross-session cacheable
const volatileParts = parts.slice(boundary)      // per-session, per-turn
// Apply cache markers to staticParts, no markers on volatileParts
```

---

## Function: `loadSystemMd`

**File**: `packages/core/src/session/engine/system.ts`

```typescript
/**
 * Loads and parses `system.md` from the bundled prompts directory.
 * Populates the `SectionRegistry` with all discovered sections.
 * Idempotent: subsequent calls are no-ops if the registry is already populated.
 *
 * Must be called before any `resolveSystemPromptSections()` invocation.
 * Called automatically on the first `resolveSystemPromptSections()` call (lazy init).
 *
 * @throws {SystemPromptLoadError} if the file is missing or unreadable
 */
export async function loadSystemMd(): Promise<void>
```

---

## Removed API Surface

The following APIs are **deleted** as part of this feature (FR-008, FR-009):

```typescript
// DELETED — use resolveSystemPromptSections(model) instead
namespace Bundled {
  // REMOVED: no longer accepts a provider name string
  async function systemPrompt(name: string): Promise<string>
}

// DELETED — provider dispatch is now internal to resolveSystemPromptSections()
namespace SystemPrompt {
  async function provider(model: Provider.Model): Promise<string[]>
  // DELETED — Codex-specific path removed; system prompt delivered via standard system[]
  async function instructions(): Promise<string>
}
```

**Migration guide for call sites**:

| Old call | New call |
|----------|----------|
| `await SystemPrompt.provider(model)` | `const { parts } = await resolveSystemPromptSections(model)` |
| `await Bundled.systemPrompt("gemini")` | *(remove — resolved via conditional section in system.md)* |
| `system = [...(await SystemPrompt.provider(model)), ...environment, ...skills]` | `system = [...parts, ...environment, ...skills]` |

---

## `system.md` Section Directive Format

This is the file-level contract governing how `system.md` authors declare sections.

```
<!-- section: <name> scope: <static|volatile> providers: <all|tag[,tag...]> -->
<content>
<!-- /section -->
```

**Attribute rules**:
- `name`: lowercase kebab-case, must match `/^[a-z][a-z0-9-]*$/`
- `scope`: exactly `static` or `volatile`
- `providers`: `all` or a comma-separated list of `ProviderTag` values

**Valid `ProviderTag` values**: `gemini`, `anthropic`, `openai`, `google-code-assist`, `trinity`, `default`

> **Note**: `codex` is no longer a valid `ProviderTag`. Content from `codex_header.md` that is
> universal has been merged into `providers: all` sections. OpenAI OAuth (Codex) sessions
> receive the same prompt as all OpenAI sessions via the standard `system` messages array.

**Example**:

```markdown
<!-- section: identity scope: static providers: all -->
You are LiteAI, the most capable coding agent on the planet...
<!-- /section -->

<!-- section: gemini-workflow scope: static providers: gemini -->
## Gemini-Specific Workflow
Use the `read` tool for file access...
<!-- /section -->

<!-- section: environment scope: volatile providers: all -->
You are powered by the model named {{model.api.id}}...
<!-- /section -->
```

> [!IMPORTANT]
> Static sections MUST appear before volatile sections in `system.md`. A `SectionOrderError` is thrown at parse time if this constraint is violated.
