# Research: Unified System Prompt Resolution

**Feature**: `001-unified-system-prompt`  
**Phase**: 0 — Outline & Research  
**Date**: 2026-04-10

---

## 1. Section Boundary Marker Format

**Decision**: HTML comment directives — `<!-- section: <name> scope: <static|volatile> providers: <all|id,...> -->` … `<!-- /section -->`

**Rationale**: Invisible to all Markdown renderers (GitHub, VS Code Preview, Storybook). No template engine required. Regex-parseable with a single pass. Consistent with existing `<!-- -->` usage in the codebase (e.g., `spec.md` clarifications). Markers are stripped before the content reaches the LLM — the model never sees them.

**Alternatives considered**:
- YAML front-matter blocks per section: rejected — requires splitting the file into sub-files or a custom multi-document YAML parser.
- `{{#if provider == "gemini"}}…{{/if}}` Handlebars/Mustache syntax: rejected — introduces a template engine dependency and is partially visible in plain-text rendering.
- JSX-style `<Section name="identity" scope="static">` tags: rejected — requires an XML parser and breaks pure-markdown tooling.

---

## 2. Section Registry Cache Design

**Decision**: Module-level `Map<string, string>` singleton (process-global). First-write-wins for concurrent misses. No lock, no promise deduplication.

**Rationale**: Spec FR-003 explicitly states: "Concurrent cache-miss calls … are handled with first-write-wins semantics — no lock or promise deduplication is required." All section compute functions are pure and deterministic (same file content → same string). Duplicate computation on a cold start is O(1) extra disk reads at worst and is bounded by the number of distinct providers on first boot, not by ongoing concurrency.

**Alternatives considered**:
- `Promise`-based deduplication map (in-flight cache): Would prevent duplicate I/O on cold start but adds ~40 lines of bookkeeping code and a `WeakRef` GC concern. Rejected per spec — unnecessary complexity for a deterministic pure function.
- `Mutex`-per-key locking (e.g., `async-mutex`): Rejected — would be a runtime dependency addition with zero correctness benefit given the pure-deterministic compute constraint.
- `WeakMap` keyed on compute function references: Rejected — keys are string names, not function references; `Map<string, string>` is the correct structure.

---

## 3. Dynamic Boundary Marker — Representation

**Decision**: Exported `number` constant (`SYSTEM_PROMPT_DYNAMIC_BOUNDARY: number`). Computed post-assembly as the length of the static portion of the `string[]`. No sentinel element inserted into the array.

**Rationale**: Spec FR-006 mandates: "No sentinel string elements are inserted into the array." The `number` approach is zero-overhead for callers — `system.slice(0, SYSTEM_PROMPT_DYNAMIC_BOUNDARY)` for static, `system.slice(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)` for dynamic. TypeScript types ensure misuse is caught at compile time. Consistent with how Anthropic SDK breakpoints work: they operate on index offsets, not content markers.

**Alternatives considered**:
- Sentinel string (`"---DYNAMIC---"`): Rejected by spec. Would contaminate the LLM prompt if boundary logic has a bug.
- Structured return type `{ static: string[], dynamic: string[] }`: Rejected per spec clarification — callers use `string[]` + `number`. The structured type would require changing every call site in `query.ts` and `llm.ts`.
- Symbol-tagged tuple `[string, typeof BOUNDARY_SYMBOL, ...string[]]`: Exotic, requires TypeScript 4.1+ variadic tuples and provides no runtime advantage.

---

## 4. Provider Matching Strategy

**Decision**: Deterministic, priority-ordered enum-based matching. Provider IDs are resolved to a typed `ProviderTag` (e.g., `"gemini"`, `"anthropic"`, `"openai"`, `"google-code-assist"`, `"trinity"`, `"codex"`, `"default"`) before being passed to the section filter. Sections list their providers as a comma-separated set of these tags.

**Rationale**: The old `SystemPrompt.provider()` used a fragile `string.includes()` chain. Partial matches (e.g., a model ID containing both "gpt" and "o3") had undefined behavior. A typed enum-based tag eliminates ambiguity: model → tag mapping is defined once in the resolver and is deterministic for any model ID.

**Alternatives considered**:
- Pass raw `model.api.id` string through to section filter and re-evaluate `includes()` per section: Rejected — recreates the original fragility and partial-match problem.
- Provider-first class objects with a `matches(section)` method: Overkill for a string-set membership check. Adds indirection without benefit.

---

## 5. Resolver Parallelism Model

**Decision**: `Promise.all()` over all volatile section compute functions. Static sections are always synchronous reads from the in-memory cache after warm-up. The resolver _first_ resolves static sections (synchronous map lookups), then `Promise.all`s any volatile compute functions in parallel.

**Rationale**: Spec FR-005: "evaluates all registered sections in parallel (where independent)." Static sections are already O(1) after boot. Only volatile sections (environment info, skills, dynamic MCP context) incur async I/O and benefit from parallelism.

**Alternatives considered**:
- Sequential `for...of await`: Simple but leaves async I/O latency additive. Rejected.
- Worker-thread parallelism: Gross overkill for string-returning functions. Rejected.
- Effect-ts `Effect.all` with structured concurrency: Powerful but introduces a heavy dependency for a feature that doesn't require Effect's error model. Rejected — `Promise.all` is sufficient and is already the project's pattern (see `query.ts` line 152: `Promise.all([...files, ...fetches])`).

---

## 6. `system.md` Migration Strategy

**Decision**: Write a single consolidated `system.md` with HTML comment section directives. Migrate all 9 legacy files' content into provider-conditional sections. Delete legacy files only after migration is validated by integration tests.

**Rationale**: The existing `system.md` (4.5 KB, 44 lines) already contains the shared "Core Mandates & Safety", "Tone, Style, and Communication", "Workflow & Task Management", "Tool Usage Policy", and "Coding Standards" sections common to all providers. The 9 legacy files contain provider-specific workflow guidance (e.g., Gemini "use 'read' tool" vs Anthropic "use Read tool") that maps cleanly to conditional sections.

**File size inventory**:
| File | Size | Destination |
|------|------|-------------|
| `system.md` | 4.6 KB | Base for unified template |
| `anthropic.md` | 8.3 KB | `<!-- section: anthropic-workflow scope: static providers: anthropic -->` |
| `beast.md` | 11.2 KB | `<!-- section: openai-workflow scope: static providers: openai -->` |
| `codex_header.md` | 7.5 KB | `<!-- section: codex-workflow scope: static providers: codex -->` |
| `default.md` | 9.8 KB | `<!-- section: default-workflow scope: static providers: default -->` |
| `gemini.md` | 15.6 KB | `<!-- section: gemini-workflow scope: static providers: gemini -->` |
| `google-code-assist-v1.md` | 10.4 KB | `<!-- section: gca-workflow scope: static providers: google-code-assist -->` |
| `google-code-assist.md` | 0.2 KB | Alias → consolidated into GCA section |
| `trinity.md` | 7.9 KB | `<!-- section: trinity-workflow scope: static providers: trinity -->` |

**Alternatives considered**:
- Keep 9 files, add a thin dispatch wrapper that reads them lazily and caches: Rejected — violates FR-001, FR-012, FR-013. Does not consolidate the content.
- Generate `system.md` from 9 files at build time: Adds a build step and a code-gen dependency. Rejected — spec assumption is runtime file reading via `import.meta.dir`.

---

## 7. Hot-Reload / Cache Invalidation

**Decision**: `clearAll()` static method on `SectionRegistry`. Called explicitly by process lifecycle hooks (e.g., on SIGHUP or test teardown). Not triggered automatically by file-watcher.

**Rationale**: Spec assumption §134: "Hot-reload support (cache invalidation on file change) is a future concern and is explicitly out of scope." The `clearAll()` method is required by spec (FR-003 acceptance scenario §4) but file-watcher integration is deferred.

---

## 8. Error Propagation Model

**Decision**: Throw a typed `SystemPromptError` (extending `NamedError` from `@liteai/util/error`) on:
1. `system.md` missing or unreadable at first resolution (FR-011)
2. Any section compute function throwing asynchronously (propagated through `Promise.all` rejection)

**Rationale**: Spec FR-011 and edge-case §85–88. The existing `NamedError` infrastructure (used throughout `query.ts`) provides structured, serializable, log-friendly error types. Silent fallbacks are banned by constitution §VI.

**Alternatives considered**:
- `process.exit(1)` on missing `system.md`: Too aggressive for a library/server. The error should be catchable by the orchestrator.
- Return `[]` on empty system prompt: Violates constitution §VI (no silent fallbacks).

---

## 9. Boundary Enforcement: Static vs. Volatile Sections

**Decision**: The section registry enforces section ordering at _registration time_, not at resolution time. Each section declares its scope (`static` | `volatile`) via the `<!-- section -->` directive. The resolver partitions registered sections into two ordered buckets: static first, volatile after. SYSTEM_PROMPT_DYNAMIC_BOUNDARY = `static.length`.

**Rationale**: Spec FR-007 + edge-case §89: "The section registry MUST enforce section ordering at registration time, not at resolution time." This means the `system.md` parse step must validate that no volatile section appears before a static section in the file order. If a violation is detected, the resolver throws at startup.

---

## 10. Test Strategy

**Decision**: Unit tests for `SectionRegistry` (cache, volatile, clearAll) and `SectionParser` (`system.md` → `ParsedSection[]`). Integration tests for `resolveSystemPromptSections()` → `string[] + SYSTEM_PROMPT_DYNAMIC_BOUNDARY`. Snapshot tests for boundary partitioning.

**Test location**: `packages/core/test/session/engine/system-prompt/`

**Run command** (scoped):
```
bun test test/session/engine/system-prompt
```
