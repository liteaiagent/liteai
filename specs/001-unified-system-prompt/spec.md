# Feature Specification: Unified System Prompt Resolution

**Feature Branch**: `001-unified-system-prompt`  
**Created**: 2026-04-10  
**Status**: Draft  
**Input**: User description: "Refactor system prompt resolution to consolidate multiple provider-specific .md files into a single unified system.md with a section-based resolver, dynamic boundary marker, and cached section registry"

## Clarifications

### Session 2026-04-10

- Q: What syntax/format should mark section boundaries and provider conditions inside `system.md`? → A: HTML comment directives — sections are delimited by `<!-- section: name scope: static|volatile providers: all|<id> -->` … `<!-- /section -->` markers, which are invisible to markdown renderers and require no template engine.
- Q: What is the representation of `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`? → A: Exported index constant — the resolver exports `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` as a `number` after assembly; callers use it to slice the `string[]` (e.g., `system.slice(0, SYSTEM_PROMPT_DYNAMIC_BOUNDARY)` for static, `system.slice(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)` for dynamic). No sentinel strings or structured return types.
- Q: What is the concurrency model for the Section Registry cache? → A: First-write-wins, no lock — section compute functions are pure and deterministic (file read + fixed string return), so concurrent cache-miss calls may both compute; duplicate work is acceptable and both writes produce identical output. No mutex or promise deduplication is required.
- Q: How should the system handle section ordering to satisfy SYSTEM_PROMPT_DYNAMIC_BOUNDARY if a volatile section appears before a static section inside system.md? → A: The parser throws a typed startup error immediately (Strict Ordering).
- Q: Should resolveSystemPromptSections() emit telemetry logic/logs given its position on the hot path? → A: No, keep it completely silent on the happy path to reduce infrastructure noise, logging only errors.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Single Canonical Prompt Source (Priority: P1)

A developer maintaining the LiteAI codebase currently must update up to 9 different `.md` files whenever shared agent behavior (tone, tool usage rules, task guidance) needs to change. They want a single authoritative file that governs all providers, with only genuinely provider-specific content branching inside it.

**Why this priority**: This is the root cause of the content duplication problem and directly reduces maintenance burden. Every other story depends on having a unified template as the single source of truth.

**Independent Test**: A developer modifies shared tone instructions in `system.md` and confirms the change is reflected when the session resolves the system prompt for every supported provider (Anthropic Claude, Gemini, OpenAI GPT/Codex, Google Code Assist, Trinity, and the default fallback) — without touching any other file.

**Acceptance Scenarios**:

1. **Given** the unified `system.md` contains a shared "Tone & Style" section, **When** a session resolves the system prompt for any supported provider, **Then** the resolved output includes the shared tone content without duplication across files.
2. **Given** a provider-specific section (e.g., Gemini-only workflow guidance) is marked conditional in `system.md`, **When** a session resolves the prompt for a non-Gemini provider, **Then** that section is absent from the resolved output.
3. **Given** all 9 legacy provider-specific `.md` files are deleted, **When** the system is started, **Then** no errors are thrown and all providers continue to receive valid system prompts.

---

### User Story 2 - Memoized Static Section Cache (Priority: P2)

The system serves many concurrent sessions. Static content (identity, safety mandates, tool usage rules) does not change between sessions, yet is currently re-read from disk on every turn. A developer wants static sections to be computed once per process lifetime and reused across all sessions without stale data risk.

**Why this priority**: This is a correctness and performance concern that affects every live session. Without memoization, disk I/O and string processing overhead accumulates at scale in a multi-tenant environment.

**Independent Test**: Instrument the section registry; start two independent sessions with different providers. Confirm that the static sections resolve only once (cache hit on the second call) while dynamic sections (e.g., environment info, skills) are recomputed per turn.

**Acceptance Scenarios**:

1. **Given** the section registry is empty at process start, **When** the first session resolves the static "Identity" section, **Then** the section is computed and stored in the global cache.
2. **Given** the "Identity" section is already cached, **When** a second session calls `systemPromptSection("identity", ...)`, **Then** the cached value is returned without re-executing the compute function.
3. **Given** a volatile section is registered with `DANGEROUS_uncachedSystemPromptSection`, **When** any session resolves that section, **Then** the compute function is always re-executed, never returning a stale cached value.
4. **Given** the cache is cleared (e.g., on hot-reload signal), **When** the next session resolves any previously-cached section, **Then** the compute function runs again to rebuild the cache entry.

---

### User Story 3 - Dynamic Boundary Marker for Prompt Caching (Priority: P2)

LiteAI sessions benefit from provider-level prompt caching (e.g., Anthropic's cache-control breakpoints). To maximize cache hits, everything before a defined boundary in the prompt should be treated as static and eligible for cross-session caching; everything after the boundary is volatile (per-session, per-turn). A developer needs a stable, clearly-defined split point within the resolved prompt array.

**Why this priority**: Misplacing dynamic content in the static segment causes cache invalidation on every turn, directly increasing per-turn cost and latency. This story ensures the boundary is explicit and correctly positioned.

**Independent Test**: Resolve the system prompt for two sessions with different environment states. Confirm that all prompt parts before `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` are identical between sessions, and that only the parts after the boundary differ.

**Acceptance Scenarios**:

1. **Given** the resolved prompt contains environment info (working directory, model ID, date), **When** the prompt is assembled, **Then** environment info appears only after the `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker index in the returned `string[]`.
2. **Given** the resolved prompt contains identity and safety mandates, **When** the prompt is assembled, **Then** identity and safety content appears only before the `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker index.
3. **Given** a provider that supports prompt caching, **When** the system constructs the LLM request, **Then** cache-control breakpoints are applied only at or before the boundary index, not within dynamic sections.

---

### User Story 4 - Collapsed Provider Dispatch Logic (Priority: P3)

The current `SystemPrompt.provider()` method uses a long chain of `if (model.api.id.includes(...))` string matches to select one of 9 files. Additionally, `llm.ts` and `agent.ts` contain Codex/OpenAI OAuth-specific branches (`isCodex`) that bypass the provider() call entirely and pipe the prompt via a separate `options.instructions` API field instead of the standard `system` messages array. A developer wants all of this removed: one resolver, one code path, every provider treated identically.

**Why this priority**: This is a maintainability improvement that follows from Story 1 and Story 2. It reduces cognitive overhead in the engine layer and eliminates a hidden provider-specific branch that breaks the provider-neutral contract.

**Independent Test**: Remove `SystemPrompt.provider()`, `SystemPrompt.instructions()`, and all `isCodex` branches. Invoke the new unified resolver with each previously-supported provider/model combination (including OpenAI OAuth/Codex) and confirm each returns a correctly structured `string[]` with no runtime errors. Confirm the system prompt reaches the model via the standard `system` messages array for all providers.

**Acceptance Scenarios**:

1. **Given** the resolver receives a Gemini model, **When** it resolves the system prompt, **Then** the output includes Gemini-specific conditional sections and excludes Anthropic-specific ones.
2. **Given** the resolver receives an unrecognized model ID, **When** it resolves the system prompt, **Then** it returns the default (generic) sections without throwing an error.
3. **Given** `Bundled.systemPrompt(name)` is called with any of the legacy provider names, **When** the new API is used, **Then** the call site either uses the new single-entry-point API or a typed deprecation error is thrown at compile time (not silently swallowed at runtime).
4. **Given** an OpenAI OAuth (Codex) session, **When** the system prompt is assembled, **Then** it is delivered via the standard `system` messages array — identical to every other provider — with no `options.instructions` override and no `isCodex` branch.

---

### Edge Cases

- What happens when `system.md` is missing or unreadable at startup? The system must throw a typed startup error immediately rather than silently falling back to an empty prompt.
- What happens when a section's compute function throws asynchronously? The error must propagate through `resolveSystemPromptSections()` and must not silently produce a partial prompt.
- How does the system handle a model ID that partially matches multiple provider patterns? The resolver must apply deterministic, priority-ordered matching, not first-match ambiguity from the old string-include chain.
- What happens when a cached section's compute function becomes invalid after a code hot-reload? The cache must provide an explicit `clearAll()` mechanism tied to the reload lifecycle, not rely on process restart.
- What happens when a `volatile` section appears before a `static` section in `system.md` (or `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` is misplaced)? The system MUST throw a typed startup error immediately (Strict Ordering) to enforce section ordering at registration/parsing time, preventing silent cache degradation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST load all system prompt content from a single `system.md` file; no session-level code paths may selectively load provider-named `.md` files.
- **FR-002**: The system MUST support named, individually addressable sections within `system.md`, delimited by HTML comment directives in the form `<!-- section: <name> scope: <static|volatile> providers: <all|comma-separated-provider-ids> -->` … `<!-- /section -->`. These markers are invisible to markdown renderers and require no template engine. Each section can be marked as static (cacheable) or volatile (dynamic).
- **FR-003**: The section registry MUST memoize static sections with global (cross-session) scope, ensuring the compute function is called at most once per process lifetime per section unless the cache is explicitly cleared. Concurrent cache-miss calls (multiple sessions resolving the same uncached section simultaneously) are handled with first-write-wins semantics — no lock or promise deduplication is required, as all compute functions MUST be pure and deterministic (identical inputs always produce identical output).
- **FR-004**: The section registry MUST support a `DANGEROUS_uncachedSystemPromptSection(name, computeFn, reason)` registration path for volatile sections that recompute on every call; the `reason` parameter MUST be a non-empty string documenting why caching is unsafe.
- **FR-005**: The resolver MUST expose a `resolveSystemPromptSections()` function that evaluates all registered sections in parallel (where independent) and returns a `string[]` in the correct assembly order.
- **FR-006**: The resolver MUST return a `boundary: number` value as part of the `resolveSystemPromptSections()` return object, representing the array index at which static content ends. Content at indices `[0, boundary)` is static and cross-session cacheable; content at indices `[boundary, length)` is volatile. No sentinel string elements are inserted into the `parts` array. `boundary` MUST NOT be exported as a module-level variable — it is session-scoped and varies per call; exposing it globally would create a multi-tenant data race in a concurrent server.
- **FR-007**: Sections appearing before `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` in the final prompt MUST contain only content that is invariant across sessions and turns (no model ID, no working directory, no date, no per-session MCP or skill state).
- **FR-008**: The `Bundled.systemPrompt(name)` API MUST be replaced with a single-entry-point function that does not accept a provider name string; callers that previously used the old API must be updated.
- **FR-009**: The `SystemPrompt.provider()` dispatch function MUST be removed; provider and model are passed as parameters to the unified resolver, not used as file selectors.
- **FR-010**: The provider/model parameter passed to the resolver MUST be used only to evaluate conditional sections within `system.md`; it MUST NOT determine which file is loaded.
- **FR-011**: If `system.md` is absent or unreadable, the system MUST throw a structured, typed error at startup (or first resolution), not silently return an empty prompt or fall back to legacy files.
- **FR-012**: The unified `system.md` MUST contain all content currently spread across the 9 legacy files, with provider-specific content expressed as conditional sections, not duplicate full-file variants. Content from `codex_header.md` that is universal (coding standards, git hygiene, tool usage) MUST be merged into `providers: all` sections — no `providers: codex` section is permitted.
- **FR-013**: The legacy provider-specific `.md` files (`anthropic.md`, `gemini.md`, `beast.md`, `trinity.md`, `default.md`, `codex_header.md`, `google-code-assist.md`, `google-code-assist-v1.md`) MUST be deleted from the repository after migration is verified.
- **FR-014**: The `SystemPrompt.instructions()` function and all `isCodex` provider-specific branches in `llm.ts` and `agent.ts` MUST be removed. The system prompt MUST be delivered via the standard `system` messages array for all providers without exception.
- **FR-015**: The prompt resolver MUST NOT emit telemetry spans or info-level logs on successful resolutions to prevent noise and latency overhead on the hot path; it MUST only log during error conditions.

### Key Entities

- **Section Registry**: A global, in-process registry that maps section names to their compute functions, caching scope (`global` or `volatile`), and cached values. Lives for the process lifetime.
- **System Section**: A named unit of prompt content with an associated compute function and a declared scope. Sections compose into the final `string[]` in a fixed order.
- **Dynamic Boundary Marker**: A per-call `boundary: number` value returned as part of the `resolveSystemPromptSections()` result object `{ parts: string[], boundary: number }`. It is the array index at which static content ends; callers destructure `const { parts, boundary } = await resolveSystemPromptSections(model)` and slice at `boundary` to separate cacheable from volatile content. It is NOT exported as a module-level constant — each call independently computes the boundary for its session context, preventing multi-tenant race conditions.
- **Unified Template (`system.md`)**: A single markdown file containing all system prompt content. Provider-conditional sections are delimited by HTML comment directives (`<!-- section: name scope: static|volatile providers: all|<id> -->` … `<!-- /section -->`). The resolver strips these markers before returning section text; they are never visible in the final LLM prompt.
- **Resolver**: A TypeScript module responsible for reading `system.md`, evaluating conditional sections against the active provider/model, pulling static sections from the registry cache, and assembling the final `string[]`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After migration, a change to any shared prompt section (e.g., tone, safety mandates) requires editing exactly one file (`system.md`), verifiable by grep showing zero other prompt files contain the same shared content.
- **SC-002**: Static section resolution for the second and subsequent sessions adds zero file-system reads, measurable by file I/O instrumentation showing no `.md` reads after initial cache warm-up.
- **SC-003**: The total number of system prompt source files decreases from 9 to 1, verifiable by directory listing of `bundled/prompts/system/`.
- **SC-004**: All previously-supported provider/model combinations (Anthropic Claude, Gemini, OpenAI GPT series, Google Code Assist, Trinity, default) continue to receive non-empty, structurally valid system prompts, verifiable by running the existing session integration tests with each model type.
- **SC-005**: The `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker correctly partitions the resolved prompt such that all content before the boundary is byte-for-byte identical between two sessions on the same provider, verifiable by snapshot comparison in tests.
- **SC-006**: The TypeScript build produces zero new type errors and zero new lint warnings after the migration, verifiable by `bun typecheck` and `bun lint:fix` passing cleanly on the modified files.

## Assumptions

- The 9 legacy `.md` files are the exhaustive set of provider-specific prompts; no other file system locations contain provider-dispatched prompt content that would need to be migrated.
- Provider-specific differences between the legacy files are limited to instruction phrasing (e.g., "Use 'read' tool" vs "Use Read tool") and workflow ordering — not fundamentally different behavioral contracts — making conditional sections in a single file sufficient.
- The existing `SystemPrompt.environment()`, `SystemPrompt.skills()`, and `InstructionPrompt.system()` functions in `query.ts` remain in their current form and are treated as the dynamic section inputs passed after the boundary marker; refactoring those functions is out of scope.
- The `Bundled` module continues to load content from the filesystem using `import.meta.dir`-relative paths, consistent with the existing single-file compile strategy.
- Hot-reload support (cache invalidation on file change) is a future concern and is explicitly out of scope; the cache is cleared only on process restart or explicit programmatic call.
- The `google-code-assist.md` file (216 bytes) is a thin redirect/alias; its effective content is already covered by `google-code-assist-v1.md` and will be consolidated as a single conditional section.
- The OpenAI Responses API accepts standard `system` role messages; no `options.instructions` override is required for Codex/OpenAI OAuth sessions. The `isCodex` detection and the separate `instructions` code path are therefore unnecessary and are removed as part of this refactor.
