# System Prompt Pipeline

This document describes the **Unified System Prompt Resolution** architecture — the single-source-of-truth prompt system that replaced the legacy per-provider file dispatch model.

> **Related spec:** `specs/001-unified-system-prompt/spec.md`  
> **Source:** [`src/session/engine/`](../src/session/engine/)

---

## Overview

LiteAI constructs every LLM request's system prompt from a **single canonical file** (`system.md`) using a section-based pipeline. The pipeline resolves sections, evaluates provider conditions, and partitions the final prompt into a static (cacheable) and volatile (per-session) region for maximum prompt cache efficiency.

```mermaid
flowchart LR
    subgraph Startup
        A[system.md] -->|SectionParser.parse| B[ParsedSection[]]
    end

    subgraph Registration
        B --> C{scope?}
        C -->|static| D[SectionRegistry.register]
        C -->|volatile| E[DANGEROUS_uncachedSystemPromptSection]
    end

    subgraph Resolution
        F[resolveSystemPromptSections model] --> G[SectionRegistry.resolve × N]
        G --> H["{ parts: string[], boundary: number }"]
    end

    D --> G
    E --> G
```

---

## Key Concepts

### Single Canonical Source — `system.md`

All system prompt content lives in a single Markdown file (`bundled/prompts/system.md`). Provider-specific instructions are expressed as **conditional sections** within that file — not as separate file copies.

Sections are delimited by HTML comment directives, which are invisible to Markdown renderers:

```html
<!-- section: identity scope: static providers: all -->
You are LiteAI, an AI coding assistant.
<!-- /section -->

<!-- section: gemini-workflow scope: static providers: gemini -->
Gemini-specific workflow guidance...
<!-- /section -->

<!-- section: environment scope: volatile providers: all -->
(dynamically injected per-turn)
<!-- /section -->
```

Each directive declares:

| Attribute | Values | Meaning |
|---|---|---|
| `name` | any identifier | Unique section name |
| `scope` | `static` or `volatile` | Caching behavior |
| `providers` | `all` or comma-separated tags | Which providers see this section |

**Provider tags** are resolved from the model ID via `resolveProviderTag()`:

| Tag | Matches |
|---|---|
| `codex` | `gpt-5` models |
| `openai` | `gpt-*`, `o1`, `o3` models |
| `google-code-assist` | Google Code Assist provider |
| `gemini` | `gemini-*` models |
| `anthropic` | `claude` models |
| `trinity` | Trinity models |
| `default` | Everything else |

### Section Registry

**Source:** [`src/session/engine/section-registry.ts`](../src/session/engine/section-registry.ts)

The `SectionRegistry` is a global (process-lifetime) singleton that maps section names to their compute functions and cached values. It is the core caching and resolution layer.

| Method | Purpose |
|---|---|
| `register(section, computeFn)` | Register a **static** section. Compute function runs at most once per process lifetime. |
| `DANGEROUS_uncachedSystemPromptSection(section, computeFn, reason)` | Register a **volatile** section. Compute function runs on every resolution call. Requires a non-empty `reason` string documenting why caching is unsafe. |
| `resolve(name, ctx?)` | Resolve a section by name. Returns cached value for static sections; recomputes for volatile. |
| `clearAll()` | Invalidate all cached static entries. Used on hot-reload or test cleanup. |
| `all()` | Return all registered entries in insertion order. |

**Concurrency model:** First-write-wins with no lock. All compute functions must be pure and deterministic, so duplicate concurrent computations produce identical output.

### Static / Volatile Boundary

**Source:** [`src/session/engine/system.ts`](../src/session/engine/system.ts) — `resolveSystemPromptSections()`

The resolver returns `{ parts: string[], boundary: number }`:

- `parts[0..boundary)` — **Static** content. Identical across all sessions using the same provider. Eligible for cross-session prompt caching.
- `parts[boundary..length)` — **Volatile** content. Changes per session and per turn (model ID, working directory, date, skills, etc.).

```
┌─────────────────────────────────────────────┐
│  Static sections (identity, safety, tools)  │  ← cacheable, computed once per process
├─────────────────────────────────────────────┤  ← boundary index
│  Volatile sections (environment, skills)    │  ← recomputed per turn
└─────────────────────────────────────────────┘
```

> **Important:** The `boundary` value is **per-call, session-scoped** — it is NOT a module-level constant. Exporting it globally would cause multi-tenant data races in a concurrent server. Callers destructure: `const { parts, boundary } = await resolveSystemPromptSections(model)`.

### Strict Ordering

If `system.md` contains a volatile section placed before a static section, the parser throws a `SectionOrderError` at startup. This prevents silent prompt-cache degradation.

---

## Resolution Flow

```
1. SystemPrompt.loadSystemMd()
   ├── Bundled.systemMd() → read raw system.md content  
   ├── SectionParser.parse(rawContent) → ParsedSection[]  
   └── Register each section in SectionRegistry  
       ├── Static → SectionRegistry.register()
       └── Volatile → DANGEROUS_uncachedSystemPromptSection()

2. SessionPrompt.resolveSystemPromptSections(model, agent?)
   ├── loadSystemMd() (idempotent — no-op if already loaded)
   ├── resolveProviderTag(model) → tag
   ├── For each registered section:
   │   ├── Skip if section.providers ≠ "all" AND doesn't include tag
   │   ├── SectionRegistry.resolve(name, model) → content
   │   ├── Append to parts[]
   │   └── Track boundary (last static section index + 1)
   ├── Append agent.prompt if present
   └── Return { parts, boundary }
```

---

## Error Handling

All errors are structured, typed, and fail-fast:

| Error Type | When |
|---|---|
| `SystemPromptLoadError` | `system.md` missing, unreadable, or parse failure |
| `SectionOrderError` | Volatile section precedes static section |
| `MissingSectionMarkerError` | Unclosed `<!-- section -->` directive |
| `DuplicateSectionError` | Two sections share the same name |
| `InvalidVolatileReasonError` | `DANGEROUS_uncachedSystemPromptSection()` called with empty reason |
| `UnknownSectionError` | `resolve()` called with unregistered section name |

---

## Telemetry

The resolver does **not** emit telemetry or info-level logs on the happy path. Logging occurs only during error conditions to minimize noise on the hot path.

---

## Sub-Agent Prompt Composition

Sub-agents **do not** inherit the parent's compiled system prompt. They invoke `resolveSystemPromptSections()` independently with their own model context, producing a complete system prompt from scratch. This means:

- Each sub-agent gets all `SectionRegistry` sections appropriate for its model
- Context pruning (stripping `liteaiMd`, `gitStatus`) is applied separately to the context objects, not to the resolver output
- The parent's prompt cache is **not shared** by standard sub-agents

**Exception:** Fork sub-agents bypass the resolver entirely and receive the parent's byte-exact rendered prompt for cache sharing (see [Fork Subagent & Agent Durability](./fork-subagent-durability.md)).

---

## Migration from Legacy

The legacy system used 9 separate `.md` files (`anthropic.md`, `gemini.md`, `codex_header.md`, etc.) with a `SystemPrompt.provider()` dispatch function that used string-includes matching. This was replaced by:

1. All content consolidated into single `system.md` with HTML comment section directives
2. `SystemPrompt.provider()` and `Bundled.systemPrompt(name)` removed
3. `SystemPrompt.instructions()` and all `isCodex` branches removed
4. All providers now receive system prompts via the standard `system` messages array

The legacy files have been deleted. The 9-to-1 consolidation is verified by directory listing of `bundled/prompts/system/`.
