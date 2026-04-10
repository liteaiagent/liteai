<!--
Sync Impact Report:
- Version change: template → 1.0.0
- List of modified principles (Added 9 core mandates):
  - Added: I. Major Release & Compatibility Policy (v-Next)
  - Added: II. Architecture & Performance
  - Added: III. Tech Stack & Execution Workflow
  - Added: IV. Variable & Linter Policy
  - Added: V. Design & Refactoring Guardrails
  - Added: VI. Strict Error Handling (Fail-Fast Protocol)
  - Added: VII. Test Resolution Protocol
  - Added: VIII. Architectural Design & Decision Protocol
  - Added: IX. Execution Gate & Planning Protocol
- Added sections: None (Used existing template structure)
- Removed sections: None
- Templates requiring updates: ✅ updated (None pending for this change)
- Follow-up TODOs: None
-->
# LiteAI Core Constitution

## Core Principles

### I. Major Release & Compatibility Policy (v-Next)
Zero Backward Compatibility. This is a new major release. BREAK backward compatibility to achieve architectural purity. DO NOT write adapter code, shims, or polyfills to support legacy interfaces.
Ruthlessly strip away legacy cruft. Prioritize modern, clean code patterns. All new implementations must strictly maintain compatibility with modern AI Agent standards (tool-calling, state management, LLM orchestration).

### II. Architecture & Performance
Multi-tenant, multi-session HTTP/Server-Sent Events (SSE) backend.
Code must be strictly non-blocking. Optimize for concurrent connections, minimal memory footprint per session, and efficient event-loop management. Ensure strict logical separation of tenant data and session states in all backend operations.

### III. Tech Stack & Execution Workflow
Strictly use `bun` for all package management and script execution. 
**Typechecking**: Always run `bun typecheck` after making modifications. Typecheck Exit Code 1 on error is expected on Windows context. Capture COMPLETE output using stream merging (`bun typecheck 2>&1 | Out-String`) without dumping to temporary text files.
**Linting**: Run `bun lint:fix` after making modifications to ensure formatting compliance.
**Testing Scope**: Never run the global test suite as it is too slow. Run scoped tests mapped directly to the modified domains.

### IV. Variable & Linter Policy
If you encounter an unused variable warning, DO NOT blindly remove it or instantly prefix it with `_` to suppress the linter. First, analyze if the variable *should* have been used. If genuinely unused but required by a signature or interface, prefix with `_` ONLY IF you add an explicit, inline comment justifying its presence.

### V. Design & Refactoring Guardrails
Structural integrity and design patterns take precedence over writing code quickly. Incremental changes should be deeply focused on the current objective. For massive architectural anti-patterns outside the current scope, explicitly propose a refactor to the technical roadmap instead of an unprompted global rewrite.

### VI. Strict Error Handling (Fail-Fast Protocol)
NO silent fallbacks (e.g. returning null, empty arrays) unless explicitly justified. Throw typed errors immediately upon encountering invalid state. Errors must be logged and bubbled up in a standardized format for User Acceptance Testing (UAT). Implement fault tolerance at the infrastructure level, not by masking internal runtime errors.

### VII. Test Resolution Protocol
Analyze First, Modify Second. If tests fail due to intentional architectural changes, update the test suite. If tests fail due to logic errors within a domain that shouldn't change, fix the implementation. If ambiguous, stop, explain to the user, and ask for definitive direction.

### VIII. Architectural Design & Decision Protocol
When tasked with a new design, feature architecture, or a large-scale change request, suspend direct execution and enter a structured design phase. Always formulate at least two distinct alternatives based on established software patterns. Use a sequential thinking process to rigorously evaluate tradeoffs. Do not make the final decision if there are significant tradeoffs; ask the user. Mandatory Architecture Decision Record (ADR) or Markdown specification must be generated before implementation.

### IX. Execution Gate & Planning Protocol
When discussing, formulating, or modifying a plan, remain in "Planning Mode." Do not prematurely modify code. Acknowledge user feedback, update the plan, and wait. Explicitly ask for permission to begin coding.

## Governance

All AI agents and contributors must strictly adhere to this constitution. 
Amendments require explicit user approval and a version bump according to semantic versioning rules.
All PRs/reviews must verify compliance with these Core Mandates. 

**Version**: 1.0.0 | **Ratified**: 2026-04-10 | **Last Amended**: 2026-04-10
