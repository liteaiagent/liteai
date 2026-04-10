# Implementation Plan: Unified System Prompt Resolution

**Branch**: `001-unified-system-prompt` | **Date**: 2026-04-10 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/001-unified-system-prompt/spec.md`

## Summary

Refactor the system prompt resolution architecture in `packages/core` to consolidate 9 provider-specific `.md` files into a single `system.md` with HTML-comment section directives, a `SectionRegistry` with first-write-wins memoization for static sections, and a `resolveSystemPromptSections()` function that returns a `string[]` plus a `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` index. The old `SystemPrompt.provider()` dispatch, `SystemPrompt.instructions()`, `Bundled.systemPrompt(name)` provider-name API, and all `isCodex` provider-specific branches in `llm.ts` and `agent.ts` are deleted. Every provider follows an identical system prompt code path.

---

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Bun runtime  
**Primary Dependencies**: `@liteai/util/error` (NamedError), Node.js `fs/promises`, Bun `import.meta.dir` bundling  
**Storage**: Filesystem — `bundled/prompts/system/system.md` (embedded in Bun compile output)  
**Testing**: `bun test` scoped to `test/session/engine/system-prompt/`  
**Target Platform**: Linux server / Windows (dev) — same compiled binary  
**Project Type**: Backend library (multi-tenant SSE server)  
**Performance Goals**: Zero disk I/O per turn for static sections after warm-up (SC-002). Volatile sections: `Promise.all()` parallel resolution  
**Constraints**: Non-blocking; no mutex/lock; pure-deterministic section compute functions; Bun `--compile` embed compatibility  
**Scale/Scope**: 6 active provider tags, N concurrent sessions, 1 cached registry per process

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Mandate | Status | Notes |
|---------|--------|-------|
| **I. Zero Backward Compatibility** | ✅ PASS | `Bundled.systemPrompt(name)` and `SystemPrompt.provider()` are deleted outright. No adapters. |
| **II. Architecture & Performance** | ✅ PASS | Module-level singleton registry; zero disk I/O on cache-hit turns; `Promise.all` for volatile parallelism |
| **III. Tech Stack & Execution** | ✅ PASS | Bun, TypeScript strict, `bun typecheck` + `bun lint:fix` required post-implementation |
| **IV. Variable & Linter Policy** | ✅ PASS | No unused-variable suppressions anticipated; all registry parameters are intentionally used |
| **V. Design & Refactoring Guardrails** | ✅ PASS | Scope is tightly bounded to `session/engine/system*`, `bundled/prompts/system/`, `session/llm.ts`, and `agent/agent.ts`; query.ts assembly updated minimally |
| **VI. Fail-Fast Protocol** | ✅ PASS | Typed errors for: missing system.md, unclosed markers, boundary order violations, empty volatile reason |
| **VII. Test Resolution Protocol** | ✅ PASS | New unit + snapshot tests written for new modules; existing tests updated where API signatures change |
| **VIII. Architectural Design Protocol** | ✅ PASS | research.md documents 10 decisions with alternatives evaluated; data-model.md and contracts documented |
| **IX. Execution Gate** | ✅ PASS | Plan presented to user before implementation begins |

**Post-design re-check**: All constitution gates remain GREEN. The design introduces no new dependencies, no adapter patterns, no cross-tenant data sharing.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-unified-system-prompt/
├── spec.md              ← Feature specification (authored)
├── plan.md              ← This file (/speckit.plan command output)
├── research.md          ← Phase 0: design decisions + alternatives
├── data-model.md        ← Phase 1: entities, types, state transitions
├── contracts/
│   └── api-contracts.md ← Phase 1: TypeScript public API surface
└── tasks.md             ← Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
packages/core/
├── src/
│   ├── bundled/
│   │   ├── index.ts                          ← MODIFY: remove systemPrompt(name), add loadSystemMd()
│   │   └── prompts/
│   │       └── system/
│   │           ├── system.md                 ← MODIFY: add HTML section directives, migrate all 9 providers
│   │           ├── anthropic.md              ← DELETE (after migration verified)
│   │           ├── beast.md                  ← DELETE (after migration verified)
│   │           ├── codex_header.md           ← DELETE (after migration verified)
│   │           ├── default.md                ← DELETE (after migration verified)
│   │           ├── gemini.md                 ← DELETE (after migration verified)
│   │           ├── google-code-assist.md     ← DELETE (after migration verified)
│   │           ├── google-code-assist-v1.md  ← DELETE (after migration verified)
│   │           └── trinity.md                ← DELETE (after migration verified)
│   └── session/
│       └── engine/
│           ├── section-parser.ts             ← NEW: SectionParser namespace
│           ├── section-registry.ts           ← NEW: SectionRegistry class + error types
│           ├── system.ts                     ← MODIFY: remove provider() + instructions(), add resolveSystemPromptSections()
│           ├── query.ts                      ← MODIFY: update system prompt assembly block
│           ├── llm.ts                        ← MODIFY: remove isCodex branches + options.instructions
│           └── agent.ts (at src/agent/)      ← MODIFY: remove Codex-specific streamObject path
│
└── test/
    └── session/
        └── engine/
            └── system-prompt/               ← NEW: all tests for this feature
                ├── section-parser.test.ts
                ├── section-registry.test.ts
                └── resolver.test.ts
```

**Structure Decision**: Single project, modular decomposition within `session/engine/`. New modules follow the existing namespace/class pattern (e.g., `SessionProcessor`, `LoopDetectionService`).

---

## Complexity Tracking

No constitution violations to justify.

---

## Phase 0: Research

✅ **Complete** — see [research.md](./research.md).

All decisions resolved:
1. Section marker format → HTML comment directives
2. Registry cache model → first-write-wins `Map<string, SectionEntry>`
3. Dynamic boundary → exported `number` constant, no sentinel
4. Provider matching → typed `ProviderTag` union, priority-ordered
5. Resolver parallelism → `Promise.all` for volatile; sync cache hits for static
6. `system.md` migration → unified template with conditional sections
7. Hot-reload → `clearAll()` method, file-watcher out of scope
8. Error propagation → typed `NamedError` subclasses, fail-fast
9. Boundary enforcement → at parse time, `SectionOrderError` throws
10. Test strategy → unit + snapshot, scoped to `test/session/engine/system-prompt`

---

## Phase 1: Design & Contracts

✅ **Complete** — see [data-model.md](./data-model.md) and [contracts/api-contracts.md](./contracts/api-contracts.md).

### New modules

| Module | Responsibility |
|--------|---------------|
| `section-parser.ts` | Parse `system.md` raw string → `ParsedSection[]` with validation |
| `section-registry.ts` | Global `SectionRegistry` class with memoization, volatile support, `clearAll()` |
| `system.ts` (modified) | `resolveSystemPromptSections()` replacing `SystemPrompt.provider()` |

### Architecture Decision: OOP Registry vs. Stateless Module

> **liteai2 uses**: A stateless module (`systemPromptSections.ts`) with the cache stored in
> `bootstrap/state.ts` as a plain `Map`. Sections are assembled inline at the `getSystemPrompt()`
> call site — no `register()`/`resolve()` abstraction exists.
>
> **LiteAI uses**: An OOP `SectionRegistry` class with explicit `register()`, `resolve()`,
> `all()`, and `clearAll()` static methods.
>
> **Rationale for divergence**:
> - **Testability**: each test instantiates with a clean registry via `clearAll()` — no global
>   state bleed between tests (liteai2 requires manual `clearSystemPromptSectionState()` calls)
> - **Encapsulation**: the registry owns both section definitions and cached values — no split
>   ownership across module-level state in a separate `bootstrap/state.ts` file
> - **Extensibility**: future features (e.g., per-tenant section overrides, hot-reload hooks)
>   can be added to `SectionRegistry` without restructuring module-level state

### Modified modules

| Module | Change |
|--------|--------|
| `bundled/index.ts` | Remove `systemPrompt(name)` (FR-008); add `loadSystemMd()` helper |
| `session/engine/query.ts` | Replace `SystemPrompt.provider(model)` call with `resolveSystemPromptSections(model)` |
| `session/engine/system.ts` | Remove `SystemPrompt.provider()` (FR-009) and `SystemPrompt.instructions()` (FR-014) |
| `session/llm.ts` | Remove `isCodex` detection, `options.instructions` override, `isCodex \|\|` on maxOutputTokens (FR-014) |
| `agent/agent.ts` | Remove Codex-specific `streamObject` branch in `Agent.generate()`; collapse to `generateObject` (FR-014) |

### Deleted files

All 8 legacy provider `.md` files under `bundled/prompts/system/` (listed in structure above). Deletion deferred until integration tests pass (SC-004).

---

## Verification Plan

### Automated Tests

```bash
# Primary test scope (new modules)
bun test test/session/engine/system-prompt

# Regression — instruction prompt (unchanged module, ensure no breakage)
bun test test/session/instruction.test.ts

# Regression — session engine
bun test test/session/engine

# TypeScript build validation
bun typecheck 2>&1 | Out-String

# Lint compliance
bun lint:fix
```

### Test Coverage Targets

| Test file | What it verifies |
|-----------|-----------------|
| `section-parser.test.ts` | Parse valid directives, unclosed marker error, order violation error, invalid attributes error, provider filter, content stripping |
| `section-registry.test.ts` | Cache hit on second call (SC-002), volatile recomputes always, `clearAll()` resets cache, duplicate registration error, empty-reason error |
| `resolver.test.ts` | Boundary index = static count (SC-005), provider filtering (Gemini vs Anthropic vs default), snapshot comparison of assembled prompt, error on missing system.md |

### Manual Verification

1. Start the dev server (`bun run dev`) with a Gemini model → confirm prompt loads correctly.
2. Start with an Anthropic model → confirm provider-specific sections included/excluded.
3. Start with an OpenAI OAuth (Codex) model → confirm the system prompt arrives via the standard `system` messages array with no `options.instructions` override.
4. Confirm `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` correctly partitions static vs volatile by inspecting the assembled `system[]` array in a debug session.
5. Delete one legacy `.md` file → confirm no startup errors (all content is in `system.md`).
6. Run `bun typecheck` → zero new type errors (SC-006).
