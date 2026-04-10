# Tasks: Unified System Prompt Resolution

**Input**: Design documents from `/specs/001-unified-system-prompt/`
**Branch**: `001-unified-system-prompt`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Data Model**: [data-model.md](./data-model.md) | **Contracts**: [contracts/api-contracts.md](./contracts/api-contracts.md)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.
**Tests**: Not explicitly requested — test tasks are included only for the registry cache and boundary (required by SC-002 and SC-005 acceptance criteria).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to

## Path Conventions

All paths are relative to `packages/core/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish new module files and shared error types before any story implementation begins.

- [ ] T001 Create `src/session/engine/section-parser.ts` with the `SectionParser` namespace stub (empty `parse()` function, correct imports from `@liteai/util/error`)
- [ ] T002 Create `src/session/engine/section-registry.ts` with the `SectionRegistry` class stub and all error type class definitions (`SystemPromptLoadError`, `MissingSectionMarkerError`, `SectionOrderError`, `InvalidSectionAttributeError`, `DuplicateSectionError`, `InvalidVolatileReasonError`) extending `NamedError`
- [ ] T003 [P] Create `test/session/engine/system-prompt/` directory with `section-parser.test.ts`, `section-registry.test.ts`, and `resolver.test.ts` stub files (empty `describe` blocks only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before any user story can be implemented. `SectionParser` and `SectionRegistry` are shared primitives — all four user stories depend on them.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Implement `SectionParser.parse()` in `src/session/engine/section-parser.ts`: single-pass regex scan for `<!-- section: <name> scope: <static|volatile> providers: <all|tag,...> -->` open markers and `<!-- /section -->` close markers; emit `ParsedSection[]` in file order; strip directive lines from content; throw `MissingSectionMarkerError` for unclosed sections; throw `InvalidSectionAttributeError` for malformed name/scope/providers values
- [ ] T005 Implement `SectionOrderError` enforcement in `SectionParser.parse()`: after collecting all `ParsedSection` entries, verify that no `scope: "static"` entry has a higher `order` than any `scope: "volatile"` entry; throw `SectionOrderError` with the violating section name if constraint is broken
- [ ] T006 Define the `ProviderTag` type union and `resolveProviderTag(model: Provider.Model): ProviderTag` function in `src/session/engine/section-registry.ts` using the exact priority-ordered matching logic from `data-model.md` (codex → openai → google-code-assist → gemini → anthropic → trinity → default)
- [ ] T007 Implement `SectionRegistry.register()` in `src/session/engine/section-registry.ts`: add entry to module-level `Map<string, SectionEntry>`; throw `DuplicateSectionError` if name already exists; mark `scope` as static
- [ ] T008 Implement `SectionRegistry.DANGEROUS_uncachedSystemPromptSection()` in `src/session/engine/section-registry.ts`: validate `reason` is non-empty (throw `InvalidVolatileReasonError` otherwise); add volatile entry to the registry map; throw `DuplicateSectionError` on duplicate name
- [ ] T009 Implement `SectionRegistry.resolve()` in `src/session/engine/section-registry.ts`: for static entries, return `cached` value if set, otherwise invoke `compute()`, store result in `cached`, return value (first-write-wins — no lock); for volatile entries, always invoke `compute()`; throw `UnknownSectionError` if name not in map
- [ ] T010 Implement `SectionRegistry.clearAll()` in `src/session/engine/section-registry.ts`: iterate all static entries and delete their `cached` field (reset to `undefined`); volatile entries are unaffected
- [ ] T011 Implement `SectionRegistry.all()` in `src/session/engine/section-registry.ts`: return `ReadonlyArray<SectionEntry>` in insertion order (Map iteration order)
- [ ] T012 Write unit tests for `SectionParser` in `test/session/engine/system-prompt/section-parser.test.ts`: valid directive parsing, content stripping, unclosed marker error, order violation error, invalid attribute error, `providers: all` vs comma-separated tags, multi-section document
- [ ] T013 Write unit tests for `SectionRegistry` in `test/session/engine/system-prompt/section-registry.test.ts`: cache hit on second call (SC-002 verification), volatile always recomputes, `clearAll()` resets cache, `DuplicateSectionError` on re-registration, `InvalidVolatileReasonError` on empty reason, `UnknownSectionError` on unknown name

**Checkpoint**: `SectionParser` and `SectionRegistry` are fully functional and tested. User story implementation can now begin.

---

## Phase 3: User Story 1 — Single Canonical Prompt Source (Priority: P1) 🎯 MVP

**Goal**: Consolidate all 9 legacy provider `.md` files into a single `system.md` with HTML comment section directives. After this phase, `system.md` is the only system prompt source file; all legacy files are scheduled for deletion.

**Independent Test**: Modify a shared section in `system.md` (e.g., "Tone & Style") and confirm through `resolveSystemPromptSections()` that the change propagates to every provider's resolved output without touching any other file. Run `bun test test/session/engine/system-prompt/resolver.test.ts`.

- [ ] T014 [US1] Audit all 9 legacy files in `src/bundled/prompts/system/` for shared vs. provider-specific content: identify sections that appear verbatim (or near-verbatim) in ≥ 2 files — these become `providers: all` static sections; identify content unique to each provider — these become provider-conditional sections
- [ ] T015 [US1] Rewrite `src/bundled/prompts/system/system.md`: add `<!-- section: identity scope: static providers: all -->` section wrapping current shared content (Core Mandates, Tone, Workflow, Tool Usage Policy, Coding Standards); add a closing `<!-- /section -->` marker
- [ ] T016 [US1] Add `<!-- section: anthropic-workflow scope: static providers: anthropic -->` … `<!-- /section -->` block to `system.md` containing the Anthropic-specific content migrated from `anthropic.md`
- [ ] T017 [US1] Add `<!-- section: openai-workflow scope: static providers: openai -->` … `<!-- /section -->` block to `system.md` containing content from `beast.md`
- [ ] T018 [US1] **Merge `codex_header.md` into universal sections** (no `providers: codex` section): audit `codex_header.md` content against all other legacy files; content that is already present in shared sections (tool usage, git hygiene, coding standards, communication style) is dropped as duplicate; any content that is genuinely absent from all other files is added to the existing `providers: all` static sections in `system.md`. No Codex-specific conditional section is created (FR-012).
- [ ] T019 [US1] Add `<!-- section: gemini-workflow scope: static providers: gemini -->` … `<!-- /section -->` block to `system.md` containing content from `gemini.md`
- [ ] T020 [US1] Add `<!-- section: gca-workflow scope: static providers: google-code-assist -->` … `<!-- /section -->` block to `system.md` containing the consolidated content from `google-code-assist-v1.md` (absorbing the `google-code-assist.md` alias)
- [ ] T021 [US1] Add `<!-- section: trinity-workflow scope: static providers: trinity -->` … `<!-- /section -->` block to `system.md` containing content from `trinity.md`
- [ ] T022 [US1] Add `<!-- section: default-workflow scope: static providers: default -->` … `<!-- /section -->` block to `system.md` containing content from `default.md`
- [ ] T023 [US1] Implement `loadSystemMd()` in `src/session/engine/system.ts`: read `system.md` via `Bundled.systemPrompt("system")` (existing API, no change to `bundled/index.ts` yet); parse with `SectionParser.parse()`; register all static sections via `SectionRegistry.register()` using a compute function that returns the section's `content` string; mark volatile sections via `DANGEROUS_uncachedSystemPromptSection()`; throw `SystemPromptLoadError` if file is missing or unreadable; make idempotent (early return if registry already populated)
- [ ] T024 [US1] Implement `resolveSystemPromptSections(model)` in `src/session/engine/system.ts`: call `loadSystemMd()` (lazy init); resolve `ProviderTag` from model; filter `SectionRegistry.all()` to matching sections; synchronously collect static section strings from cache; `await Promise.all()` for volatile section strings; return `{ parts: [...static, ...volatile], boundary: staticParts.length }`. **Do NOT export `boundary` as a module-level variable** — it is session-scoped and must be returned per-call to prevent multi-tenant data races (B1: each concurrent session gets its own boundary value from the return object, never from shared module state). Ensure no telemetry spans or info-level logs are emitted on the happy path (FR-015).
- [ ] T025 [US1] Write resolver integration test in `test/session/engine/system-prompt/resolver.test.ts`: assert that resolving for "gemini" includes gemini-workflow section but not anthropic-workflow; assert resolving for "anthropic" includes anthropic-workflow but not gemini-workflow; assert resolving for an unmatched model ID returns default section; assert `SystemPromptLoadError` is thrown when `system.md` is mocked as missing
- [ ] T026 [US1] Verify `system.md` completeness: run grep to confirm zero content overlap between the new sections and the legacy files — SC-001 criterion

**Checkpoint**: User Story 1 complete — `system.md` is the single source of truth. `resolveSystemPromptSections()` returns provider-filtered content. All 9 legacy files are still present but no longer the source of truth.

---

## Phase 4: User Story 2 — Memoized Static Section Cache (Priority: P2)

**Goal**: Guarantee that static sections are computed at most once per process lifetime. After this phase, `SectionRegistry.resolve()` performs zero disk I/O on second+ calls for static sections.

**Independent Test**: Instrument `SectionRegistry` with a call counter. Start two independent resolution cycles with different provider models. Assert the static "identity" section's compute function was invoked exactly once total (cache hit on second call — SC-002).

- [ ] T027 [US2] Add instrumentation support to `SectionRegistry` in `src/session/engine/section-registry.ts`: add `static computeCallCount: Map<string, number>` (test-only, controlled by `NODE_ENV`) that increments each time a compute function is invoked; expose `getComputeCallCount(name: string): number` method
- [ ] T028 [US2] Extend `section-registry.test.ts` with cache-hit tests (SC-002): assert `getComputeCallCount("identity") === 1` after two sequential calls to `SectionRegistry.resolve("identity")`; assert volatile section `computeCallCount` equals the number of `resolve()` calls
- [ ] T029 [US2] Extend `section-registry.test.ts` with `clearAll()` + re-compute test: assert after `clearAll()`, the next `resolve()` call re-invokes compute and `computeCallCount` increments to 2; assert cached value is the recomputed string

**Checkpoint**: User Story 2 complete — cache semantics verified by test. SC-002 acceptance criteria met.

---

## Phase 5: User Story 3 — Dynamic Boundary Marker (Priority: P2)

**Goal**: `resolveSystemPromptSections()` returns a `boundary` index that correctly partitions static from volatile content. All content before `boundary` must be byte-for-byte identical across sessions on the same provider.

**Independent Test**: Call `resolveSystemPromptSections()` twice with different mocked `model.api.id` values (same provider tag). Assert `parts.slice(0, boundary)` is byte-for-byte identical between both calls. Assert `parts.slice(boundary)` differs. Run `bun test test/session/engine/system-prompt/resolver.test.ts`.

- [ ] T030 [US3] Add `<!-- section: environment scope: volatile providers: all -->` section to `system.md` (after all static sections) as a placeholder marker. This section will be populated at runtime by a compute function that calls `SystemPrompt.environment(model)`.
- [ ] T031 [US3] Register the `environment` section in `loadSystemMd()` via `DANGEROUS_uncachedSystemPromptSection("environment", () => SystemPrompt.environment(model), "Environment info contains model ID, working directory, and date — all volatile per session/turn")` — note: `model` is passed as a parameter to `loadSystemMd()` or resolved lazily in the compute closure
- [ ] T032 [US3] Write boundary snapshot test in `resolver.test.ts`: resolve for provider "gemini" twice with a mocked environment function returning different values; snapshot-assert that `parts.slice(0, boundary)` is identical between both resolutions; assert `parts.slice(boundary)` differs (volatile environment content)
- [ ] T033 [US3] Assert in `resolver.test.ts` that `boundary === staticParts.length` — no sentinel string elements exist in the array (FR-006 compliance)

**Checkpoint**: User Story 3 complete — `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` correctly partitions the prompt. SC-005 acceptance criteria met.

---

## Phase 6: User Story 4 — Collapsed Provider Dispatch (Priority: P3)

**Goal**: Remove `SystemPrompt.provider()`, `SystemPrompt.instructions()`, and all `isCodex` provider-specific branches. Update all call sites to use `resolveSystemPromptSections()`. Remove `Bundled.systemPrompt(name)` provider-name API and replace with `loadSystemMd()`. Delete all 8 legacy `.md` files. Every provider now follows an identical code path — no special-casing.

**Independent Test**: Remove `SystemPrompt.provider()`, `SystemPrompt.instructions()`, and all `isCodex` guards. Invoke `resolveSystemPromptSections()` with each previously-supported provider/model combination (anthropic, gemini, openai, openai-oauth, google-code-assist, trinity, default). Assert each returns a non-empty `string[]` delivered via the standard `system` messages array. Run `bun test test/session/engine/system-prompt/resolver.test.ts`.

- [ ] T034 [US4] Update `src/session/engine/query.ts` system prompt assembly block (lines 325–334): replace `[...(await SystemPrompt.provider(model))]` with `const { parts: providerParts, boundary } = await resolveSystemPromptSections(model)`; update `system` array to `[...providerParts, ...(await SystemPrompt.environment(model)), ...(skills ? [skills] : []), ...(await InstructionPrompt.system())]`; pass `boundary` to the LLM request builder (see T034b); remove `SystemPrompt.provider` import
- [ ] T034b [US3] Wire `boundary` into LLM transport cache-control: locate the system prompt → LLM request builder in `packages/core/src/` (likely `src/session/processor.ts` or `src/session/llm.ts`); apply cache markers using the `boundary` value from `resolveSystemPromptSections(model)` — parts at `[0, boundary)` are eligible for cross-session caching (apply provider-appropriate cache marker, e.g. Anthropic `cache_control: { type: 'ephemeral' }` on the last static block); parts at `[boundary, length)` receive no cache marker. If the AI SDK integration does not yet support per-block cache markers, you MUST STOP and consult the developer ("Me") for guidance. Do not proceed or hide the issue with a failing/skipped test, as this is required for SC-005 end-to-end verification.
- [ ] T035 [US4] Update `src/session/engine/system.ts`: delete the `SystemPrompt.provider()` function (FR-009); delete the `SystemPrompt.instructions()` function (FR-014); remove all `Bundled.systemPrompt` imports from this file
- [ ] T036 [US4] Update `src/bundled/index.ts`: replace `systemPrompt(name: string)` with `loadSystemMd(): Promise<void>` that reads `system.md` exclusively (no `name` parameter); keep `miscPrompt`, `agentPrompt`, `agent`, `command`, `agentsDir`, `skillsDir`, `commandsDir` unchanged (FR-008 scope limited to `systemPrompt`)
- [ ] T037 [US4] Delete `SystemPrompt.instructions()` from `src/session/engine/system.ts` (already covered by T035) and search all remaining `Bundled.systemPrompt` call sites across `packages/core/src/` with `grep -r "Bundled.systemPrompt" packages/core/src/` — assert zero remaining references after T035 + T036 complete
- [ ] T038 [US4] Remove all `isCodex` branches from `src/session/llm.ts` (FR-014): delete `const isCodex = provider.id === "openai" && auth?.type === "oauth"` (L74); remove `isCodex ? []` ternary from the system array assembly (L81) — simplify to `await SystemPrompt.provider(input.model)` (interim), then to `resolveSystemPromptSections()` per T034; delete the `if (isCodex) { options.instructions = ... }` block (L128-130); remove the `isCodex ||` guard from `maxOutputTokens` (L166) — Codex now receives `maxOutputTokens` identically to all other providers
- [ ] T039 [US4] Remove the Codex-specific `streamObject` path from `src/agent/agent.ts` (FR-014): delete the `if (defaultModel.providerID === "openai" && auth?.type === "oauth")` branch at L280-293 in `Agent.generate()`; collapse to the single `generateObject` call path; remove the `Auth` import if it is no longer used elsewhere in the file
- [ ] T040 [US4] Delete legacy files from `src/bundled/prompts/system/`: `anthropic.md`, `beast.md`, `codex_header.md`, `default.md`, `gemini.md`, `google-code-assist.md`, `google-code-assist-v1.md`, `trinity.md` (FR-013). Verify deletion does not break the build — `system.md` is the only remaining file.
- [ ] T041 [US4] Write compile-time verification: run `bun typecheck 2>&1 | Out-String` and assert zero new type errors introduced by the removed APIs (SC-006)

**Checkpoint**: User Story 4 complete — provider dispatch removed, `isCodex` branches removed, `SystemPrompt.instructions()` deleted, all call sites use the unified resolver, all 8 legacy `.md` files deleted. SC-003 criterion met (directory listing shows 1 file in `bundled/prompts/system/`). Every provider follows an identical system prompt code path.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validation, linting, and documentation cleanup that spans all stories.

- [ ] T042 [P] Run `bun lint:fix` on all modified files: `src/session/engine/section-parser.ts`, `src/session/engine/section-registry.ts`, `src/session/engine/system.ts`, `src/session/engine/query.ts`, `src/bundled/index.ts`, `src/session/llm.ts`, `src/agent/agent.ts` — resolve all formatting warnings
- [ ] T043 [P] Run full scoped test suite: `bun test test/session/engine/system-prompt` and `bun test test/session/engine` — confirm zero failures; confirm no regressions in `test/session/instruction.test.ts`
- [ ] T044 Run `bun typecheck 2>&1 | Out-String` on `packages/core` — confirm zero new type errors (SC-006 final validation)
- [ ] T045 Verify SC-001: run grep to confirm no shared content (tone, safety mandates, coding standards) appears in any file outside `system.md` under `bundled/prompts/system/`
- [ ] T046 Verify SC-003: `ls packages/core/src/bundled/prompts/system/` shows exactly 1 file (`system.md`)
- [ ] T047 Verify SC-004: manually start dev server with Gemini, Anthropic, and default model configuration — confirm non-empty, structurally valid system prompts are assembled for each
- [ ] T048 [P] Update `CHANGELOG.md` or roadmap with deprecation note for `Bundled.systemPrompt(name)` and `SystemPrompt.provider()` removal in this release

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1)**: Depends on Phase 2 — can begin once `SectionParser` + `SectionRegistry` are complete
- **Phase 4 (US2)**: Depends on Phase 2 — can begin once `SectionRegistry.resolve()` is implemented (T009)
- **Phase 5 (US3)**: Depends on Phase 3 (needs volatile section registration in `loadSystemMd()`)
- **Phase 6 (US4)**: Depends on Phases 3, 4, 5 — requires `resolveSystemPromptSections()` to be fully correct before removing `provider()`
- **Phase 7 (Polish)**: Depends on all user story phases

### User Story Dependencies

```
Phase 1 (Setup)
     │
     ▼
Phase 2 (Foundational: SectionParser + SectionRegistry)
     │
     ├──► Phase 3 [US1] — Single Canonical Prompt Source
     │         │
     │         ├──► Phase 4 [US2] — Memoized Cache (parallel with US1 after T009)
     │         │
     │         └──► Phase 5 [US3] — Dynamic Boundary (depends on US1's loadSystemMd)
     │
     └──────── All complete ──► Phase 6 [US4] — Collapsed Dispatch + File Deletion
                                      │
                                      ▼
                               Phase 7 (Polish)
```

### Within Each User Story

- **US1**: T014 (audit) → T015–T022 (write system.md) → T023 (loadSystemMd) → T024 (resolveSystemPromptSections) → T025–T026 (verify)
- **US2**: T027 (instrumentation) → T028–T029 (tests)
- **US3**: T030–T031 (volatile section) → T032–T033 (boundary tests)
- **US4**: T034–T039 (call site updates) → T040 (delete legacy files) → T041 (typecheck)

### Parallel Opportunities

- T001, T002, T003 (Phase 1) — all parallel
- T004–T011 (Phase 2 implementation) — sequential within registry; T012 and T013 can be written in parallel after T004–T011 stubs exist
- T015–T022 (system.md section authoring) — all parallel (different sections of the same file, non-overlapping)
- T027–T029 (US2) can run in parallel with T030–T033 (US3) once US1 is complete
- T034–T039 (US4 call-site updates) — T036–T039 are parallel (different files); T034 depends on T024

---

## Parallel Examples

### Phase 2 — Foundational

```text
# Sequential (shared state — SectionRegistry Map):
T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011

# Parallel after stubs exist:
Task: "Unit tests for SectionParser in test/session/engine/system-prompt/section-parser.test.ts"  [T012]
Task: "Unit tests for SectionRegistry in test/session/engine/system-prompt/section-registry.test.ts"  [T013]
```

### Phase 3 — User Story 1 (Section Authoring)

```text
# All system.md section authoring tasks can run in parallel (different content blocks):
Task: "Add anthropic-workflow section to system.md"  [T016]
Task: "Add openai-workflow section to system.md"     [T017]
Task: "Add codex-workflow section to system.md"      [T018]
Task: "Add gemini-workflow section to system.md"     [T019]
Task: "Add gca-workflow section to system.md"        [T020]
Task: "Add trinity-workflow section to system.md"    [T021]
Task: "Add default-workflow section to system.md"    [T022]
```

### Phase 6 — User Story 4 (Call Site Updates)

```text
# Parallel (different files):
Task: "Update bundled/index.ts — remove systemPrompt(name)"  [T036]
Task: "Update session/llm.ts call sites"                     [T038]
Task: "Update agent/agent.ts call sites"                     [T039]

# Sequential dependency:
T034 (query.ts) depends on T024 (resolveSystemPromptSections implemented)
T035 (remove provider()) depends on T034 (all call sites migrated)
T040 (delete legacy files) depends on T035
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational — `SectionParser` + `SectionRegistry` (T004–T013)
3. Complete Phase 3: User Story 1 — write `system.md`, implement `resolveSystemPromptSections()` (T014–T026)
4. **STOP and VALIDATE**: Run `bun test test/session/engine/system-prompt` — confirm resolver returns correct content per provider
5. At this point, `system.md` is authoritative. Legacy files still exist but are bypassed.

### Incremental Delivery

1. Phase 1 + Phase 2 → Foundation ready (parser + registry tested)
2. Phase 3 → `system.md` as single source (US1 — P1, highest value)
3. Phase 4 → Cache correctness verified (US2 — P2)
4. Phase 5 → Boundary marker correct (US3 — P2)
5. Phase 6 → Legacy files deleted, old API removed (US4 — P3, cleanup)
6. Phase 7 → Polish, lint, typecheck clean

### Solo Developer Strategy

Work strictly in phase order. Use `bun test test/session/engine/system-prompt` to validate after each phase. Do not delete legacy `.md` files (Phase 6 / T040) until Phase 5 checkpoint passes — legacy files are the safety net for content correctness validation.

---

## Notes

- `[P]` tasks = different files or independent sections, no unmet dependencies
- `[Story]` label maps each task to a specific user story for traceability
- Each user story is independently testable after its phase checkpoint
- Run `bun lint:fix` after every file modification
- Run `bun typecheck 2>&1 | Out-String` after every phase to catch regressions early
- SC-002 (cache), SC-005 (boundary), SC-006 (typecheck clean) require specific test coverage — these are mandatory
- Do NOT delete legacy `.md` files (T040) until T025, T028, T032 tests all pass (content safety net)
