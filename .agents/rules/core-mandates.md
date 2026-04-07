---
trigger: always_on
---

# CORE MANDATES & SYSTEM CONSTRAINTS
This is a strict production environment, not an MVP. All code generated must prioritize long-term maintainability, strict typing, and system stability over rapid task execution.

## 0. Major Release & Compatibility Policy (v-Next)
- **Zero Backward Compatibility:** This is a new major release. You are explicitly authorized and required to BREAK backward compatibility to achieve architectural purity. DO NOT write adapter code, shims, or polyfills to support legacy interfaces.
- **Clean Code Paradigm:** Ruthlessly strip away legacy cruft. Prioritize modern, clean code patterns. 
- **AI Agent Standards:** All new implementations must strictly maintain compatibility with modern AI Agent standards. Optimize interfaces for agentic tool-calling, state management, and LLM-driven orchestration.

## 1. Architecture & Performance (`packages/core`)
- **Domain:** This package is a multi-tenant, multi-session HTTP/Server-Sent Events (SSE) backend.
- **Performance:** Code must be strictly non-blocking. Optimize for concurrent connections, minimal memory footprint per session, and efficient event-loop management.
- **Tenant Isolation:** Ensure strict logical separation of tenant data and session states in all backend operations.

## 2. Tech Stack & Execution Workflow
- **Package Manager:** Strictly use `bun` for all package management and script execution.
- **Typechecking (CRITICAL):** Run exactly `bun typecheck`. DO NOT redirect stderr or pipe the output to truncate it (e.g., absolutely NO `bun typecheck 2>&1` or `| tail -n 50`). You must ingest and analyze the raw, unaltered output.
- **Linting:** Always run `bun lint:fix` after making modifications to ensure formatting compliance.
- **Testing Scope:** A full `bun test` run takes ~30 minutes. NEVER run the global test suite. You MUST run scoped tests mapped directly to the files or domains you are modifying (e.g., `bun test test/sessions`).

## 3. Variable & Linter Policy
- **Unused Variables:** If you encounter an unused variable warning, DO NOT blindly remove it or instantly prefix it with `_` to suppress the linter. 
- **Analysis Required:** First, analyze if the variable *should* have been used (i.e., a missed implementation detail). 
- **Justified Suppression:** If the variable is genuinely unused but required by a signature or interface (e.g., an external callback function), you may prefix it with `_` ONLY IF you add an explicit, inline comment justifying its presence.

## 4. Design & Refactoring Guardrails
- **Design > Speed:** Structural integrity and design patterns take precedence over writing code quickly. 
- **The "Roadmap" Rule:** While you must drop legacy compatibility (per Directive 0), if you encounter an entirely separate domain or massive architectural anti-pattern outside your current scope, DO NOT initiate an unprompted global rewrite. Explicitly propose the refactor to be added to the technical roadmap.
- **Incremental Changes:** Keep functional changes tightly scoped to the current objective.

## 5. Strict Error Handling (Fail-Fast Protocol)
- **NO Silent Fallbacks:** Fall-back values (e.g., returning `null`, empty arrays, or default objects when an operation fails) are strictly forbidden unless explicitly justified by business logic. Silent fallbacks hide systemic issues.
- **Explicit Exceptions:** Throw structured, typed errors immediately upon encountering an invalid state. 
- **UAT Detectability:** All errors must be logged and bubbled up in a standardized format so they are immediately detectable during User Acceptance Testing (UAT).
- **Fault Tolerance:** Implement fault tolerance at the infrastructure/architectural level (e.g., circuit breakers, retry logic for external APIs), NOT by masking internal runtime errors.