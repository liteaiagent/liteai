# Data Model: Unified System Prompt Resolution

**Feature**: `001-unified-system-prompt`  
**Phase**: 1 — Design & Contracts  
**Date**: 2026-04-10

---

## Entities

### 1. `ParsedSection`

The raw product of parsing `system.md`. Produced by `SectionParser.parse()`.

```typescript
interface ParsedSection {
  /** Unique name declared in the HTML comment directive */
  name: string

  /** Caching scope. "static" → memoized globally; "volatile" → recomputed per call */
  scope: "static" | "volatile"

  /**
   * Provider tags this section applies to. "all" means every provider.
   * A Set is used for O(1) membership tests during section filtering.
   */
  providers: "all" | Set<ProviderTag>

  /**
   * Raw markdown content between the open and close markers,
   * with the HTML comment directives stripped.
   * Trailing/leading whitespace is trimmed.
   */
  content: string

  /**
   * Original file order index (0-based). Used to validate that all static
   * sections precede volatile sections (enforced at parse time).
   */
  order: number
}
```

**Validation rules**:
- `name` must be a non-empty string matching `/^[a-z][a-z0-9-]*$/`.
- `scope` must be exactly `"static"` or `"volatile"`.
- `providers` must be `"all"` or a non-empty set of valid `ProviderTag` values.
- `content` must be non-empty after trimming.
- All `ParsedSection` entries with `scope: "static"` must have a lower `order` than any entry with `scope: "volatile"` — violation throws `SectionOrderError`.

---

### 2. `ProviderTag`

A discriminated union of all supported provider identifiers. Replaces the fragile `model.api.id.includes(...)` chain.

```typescript
type ProviderTag =
  | "gemini"
  | "anthropic"
  | "openai"      // gpt-*, o1, o3 variants
  | "codex"       // gpt-5 line
  | "google-code-assist"
  | "trinity"
  | "default"
```

**Resolution logic** (replaces `SystemPrompt.provider()`):

```typescript
function resolveProviderTag(model: Provider.Model): ProviderTag {
  if (model.api.id.includes("gpt-5"))                            return "codex"
  if (model.api.id.includes("gpt-") || 
      model.api.id.includes("o1")   || 
      model.api.id.includes("o3"))                               return "openai"
  if (model.providerID === "google-code-assist")                 return "google-code-assist"
  if (model.api.id.includes("gemini-"))                          return "gemini"
  if (model.api.id.includes("claude"))                           return "anthropic"
  if (model.api.id.toLowerCase().includes("trinity"))            return "trinity"
  return "default"
}
```

**State transitions**: None — `ProviderTag` is a pure derived value from `Provider.Model`.

---

### 3. `SectionRegistry`

The global, process-scoped singleton that maps section names to compute functions and their cached output. Enforces memoization semantics.

```typescript
interface SectionEntry {
  /** The original parsed section metadata */
  section: ParsedSection

  /**
   * For volatile sections: compute function, always re-invoked.
   * For static sections: compute function invoked at most once.
   */
  compute: () => Promise<string>

  /**
   * Cached result. Undefined until first compute() call completes (static only).
   * Volatile sections never populate this field.
   */
  cached?: string
}

class SectionRegistry {
  private static readonly entries = new Map<string, SectionEntry>()

  /** Register a static (cached) section */
  static register(section: ParsedSection, compute: () => Promise<string>): void

  /**
   * Register a volatile (uncached) section.
   * @param reason Non-empty string explaining why caching is unsafe (FR-004)
   */
  static DANGEROUS_uncachedSystemPromptSection(
    section: ParsedSection,
    compute: () => Promise<string>,
    reason: string,
  ): void

  /** Resolve a section's content (cache-hit or fresh compute) */
  static resolve(name: string): Promise<string>

  /** Clear all cached values. Called on hot-reload or test teardown. */
  static clearAll(): void

  /** Return all entries in registration order */
  static all(): SectionEntry[]
}
```

**Invariants**:
- `register()` throws `DuplicateSectionError` if a section name is registered twice.
- `DANGEROUS_uncachedSystemPromptSection()` `reason` must be non-empty; throws `InvalidVolatileReasonError` otherwise.
- First-write-wins for concurrent cache misses on static sections (pure determinism guarantee — no lock needed).

---

### 4. `SectionParser`

Parses `system.md` into an ordered array of `ParsedSection` objects.

```typescript
namespace SectionParser {
  /** 
   * Parse the raw content of system.md.
   * Throws `MissingSectionMarkerError` for unclosed sections.
   * Throws `SectionOrderError` if a static section follows a volatile one.
   * Throws `InvalidSectionAttributeError` for malformed directives.
   */
  function parse(rawContent: string): ParsedSection[]
}
```

**Regex for open marker** (single-pass, case-insensitive):
```
/<!--\s*section:\s*(?<name>[a-z][a-z0-9-]*)\s+scope:\s*(?<scope>static|volatile)\s+providers:\s*(?<providers>[^\-]+?)\s*-->/gi
```

**Close marker**: `<!-- /section -->`

**State machine**:
1. IDLE: scan for open marker → transition to IN_SECTION
2. IN_SECTION: accumulate lines until close marker → emit `ParsedSection` → IDLE
3. EOF in IN_SECTION → throw `MissingSectionMarkerError`

---

### 5. `SystemPromptAssembly`

The output of `resolveSystemPromptSections()`.

```typescript
interface SystemPromptAssembly {
  /**
   * Ordered array of resolved section strings.
   * Indices [0, SYSTEM_PROMPT_DYNAMIC_BOUNDARY) are static.
   * Indices [SYSTEM_PROMPT_DYNAMIC_BOUNDARY, length) are volatile.
   */
  parts: string[]

  /**
   * The array index at which static content ends.
   * Callers use: parts.slice(0, SYSTEM_PROMPT_DYNAMIC_BOUNDARY) for cacheable,
   *              parts.slice(SYSTEM_PROMPT_DYNAMIC_BOUNDARY) for volatile.
   */
  boundary: number
}
```

**Note**: `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` is exported as a module-level constant re-exported from the last call to `resolveSystemPromptSections()`. Alternatively (simpler), it is derived as `staticParts.length` directly in `query.ts`.

---

### 6. Error Types

```typescript
// Thrown when system.md is absent or unreadable (FR-011)
class SystemPromptLoadError extends NamedError { ... }

// Thrown when a section open marker has no matching close marker
class MissingSectionMarkerError extends NamedError { ... }

// Thrown when a static section appears after a volatile section in file order
class SectionOrderError extends NamedError { ... }

// Thrown when a section directive attribute has an invalid value
class InvalidSectionAttributeError extends NamedError { ... }

// Thrown when a section name is registered twice
class DuplicateSectionError extends NamedError { ... }

// Thrown when DANGEROUS_uncachedSystemPromptSection is called with empty reason
class InvalidVolatileReasonError extends NamedError { ... }
```

All extend `NamedError` from `@liteai/util/error` for structured serialization and UAT detectability.

---

## State Transitions

```
SectionRegistry lifecycle:
  [process start]
       │
       ▼
  UNREGISTERED ──parse(system.md)──► REGISTERED
       │                                  │
       │                           [first resolve()]
       │                                  │
       │                    ┌─────────────┴──────────────┐
       │                    ▼                             ▼
       │            scope=static                  scope=volatile
       │            compute() once                compute() always
       │            cache result                  no cache
       │                    │
       │             [clearAll()]
       │                    │
       └──────────────► UNREGISTERED (cached values cleared)
```

---

## Relationship Diagram

```
system.md (1 file)
    │
    ▼ SectionParser.parse()
ParsedSection[] (N sections, ordered)
    │
    ├─► static sections ──► SectionRegistry.register()
    │                             │
    │                        [first call] compute() ──cache──► cached string
    │                        [subsequent] cache hit
    │
    └─► volatile sections ──► SectionRegistry.DANGEROUS_uncachedSystemPromptSection()
                                   │
                              [every call] compute()
                                   │
                              fresh string

resolveSystemPromptSections(model: Provider.Model):
    ├─► tag = resolveProviderTag(model)
    ├─► staticParts  = registry.all().filter(static + matches tag).map(resolve)  ← sync cache hits
    ├─► volatileParts = await Promise.all(volatile + matches tag).map(resolve))   ← parallel async
    └─► return { parts: [...staticParts, ...volatileParts], boundary: staticParts.length }
```
