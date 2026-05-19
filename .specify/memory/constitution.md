<!--
  Sync Impact Report
  ==================
  Version change: N/A → 1.0.0 (initial ratification)
  Modified principles: N/A (all new)
  Added sections:
    - Core Principles (7 principles)
    - Architecture & Technology Constraints
    - Development Workflow
    - Governance
  Removed sections: N/A
  Templates requiring updates:
    - .specify/templates/plan-template.md: ✅ Compatible (Constitution Check section already present)
    - .specify/templates/spec-template.md: ✅ Compatible (mandatory sections align with principles)
    - .specify/templates/tasks-template.md: ✅ Compatible (phase structure supports incremental delivery)
  Follow-up TODOs: None
-->

# LiteAI Constitution

## Core Principles

### I. Architectural Purity (Zero Backward Compatibility)

This is a new major release. All code MUST break backward compatibility
to achieve architectural cleanliness. Adapter code, shims, and polyfills
for legacy interfaces are strictly forbidden.

- All implementations MUST maintain compatibility with modern AI Agent
  standards, optimized for agentic tool-calling, state management, and
  LLM-driven orchestration.
- Legacy cruft MUST be ruthlessly stripped. Modern, clean code patterns
  take absolute precedence over preserving existing interfaces.
- No backward compatibility aliases, migration layers, or deprecation
  warnings — clean breaks only.

### II. Non-Blocking Performance & Tenant Isolation

The core package (`packages/core`) is a multi-tenant, multi-session
HTTP/Server-Sent Events (SSE) backend. All code MUST be strictly
non-blocking.

- Optimize for concurrent connections, minimal memory footprint per
  session, and efficient event-loop management.
- Strict logical separation of tenant data and session states MUST be
  maintained in all backend operations.
- Resource leaks (unclosed handles, orphaned subscriptions, unbounded
  buffers) are treated as critical defects.

### III. Strict Type Safety & Verification

Every code change MUST pass the full verification pipeline before it
is considered complete. No exceptions.

- `bun typecheck` MUST report zero new errors after modifications.
- `bun lint:fix` MUST complete cleanly after modifications.
- Scoped tests MUST pass for all affected domains. The full test suite
  MUST NOT be run (it takes ~30 minutes); tests MUST be scoped to the
  files or domains being modified.
- Unused variables MUST NOT be blindly removed or prefixed with `_`.
  Analysis is required to determine if the variable should have been
  used (missed implementation). Suppression with `_` is permitted only
  with an explicit inline comment justifying its presence.

### IV. Fail-Fast Error Handling

Silent fallbacks are strictly forbidden. The system MUST fail loudly
and immediately when encountering invalid state.

- Fall-back values (returning `null`, empty arrays, or default objects
  on failure) are forbidden unless explicitly justified by business
  logic. Silent fallbacks hide systemic issues.
- Structured, typed errors MUST be thrown immediately upon encountering
  an invalid state.
- All errors MUST be logged and bubbled up in a standardized format so
  they are immediately detectable during User Acceptance Testing.
- Fault tolerance MUST be implemented at the infrastructure level
  (circuit breakers, retry logic for external APIs), NOT by masking
  internal runtime errors.

### V. Design-First Development

Structural integrity and design patterns take precedence over writing
code quickly. Every significant change MUST go through a structured
design phase before implementation begins.

- For new designs, feature architectures, or large-scale changes:
  formulate at least two distinct design alternatives.
- Base designs on well-established software design patterns (Strategy,
  Factory, Reactor, State, Dependency Injection, etc.).
- Use sequential thinking to rigorously evaluate pros, cons, and system
  tradeoffs of each approach.
- If significant architectural tradeoffs exist between alternatives, the
  final decision MUST be escalated to the user — do not decide
  autonomously unless one solution is unequivocally optimal.
- A formal design artifact (ADR, specification, or diagram) MUST be
  produced before any implementation code is written.

### VI. Test Integrity & Isolation

Test failures MUST be root-cause-analyzed before any fix is applied.
Tests MUST be hermetically isolated to prevent lateral pollution.

- When a test fails, do NOT assume the implementation is broken.
  Evaluate whether the test is outdated (refactor/feature change) or
  the code has a genuine regression.
- If the root cause is ambiguous, STOP and ask — do not guess.
- No global module hijacking (`mock.module`). Prefer `spyOn` which is
  scoped and safely revertible.
- Every test block that mocks an API, database call, or environment
  variable MUST contain an explicit `afterEach` restoration block.
- Tests that operate on the filesystem MUST use uniquely named temporary
  directories. Modifying shared or hardcoded temporary locations is
  forbidden.

### VII. Incremental Scope & Controlled Change

All functional changes MUST be tightly scoped to the current objective.
Scope creep is a structural risk.

- Design quality takes precedence over implementation speed.
- If an unrelated architectural anti-pattern is discovered outside the
  current scope, it MUST be proposed for the technical roadmap — not
  fixed inline.
- When discussing or modifying a plan/design, no implementation code
  MUST be written until the user provides explicit confirmation to
  proceed (the "Execution Gate").
- Planning responses MUST end by explicitly asking for permission to
  begin coding.

## Architecture & Technology Constraints

- **Package Manager**: Strictly `bun` for all package management and
  script execution. No npm, yarn, or pnpm.
- **Runtime**: Bun runtime on Node.js-compatible APIs.
- **Language**: TypeScript with strict mode. All code MUST be strictly
  typed — no `any` escape hatches without documented justification.
- **Monorepo**: Workspace-based monorepo (`packages/*`) managed by
  Turborepo for task orchestration.
- **Core Architecture**: `packages/core` is a multi-tenant HTTP/SSE
  backend with session-based state management and agentic tool
  orchestration.
- **Frontend**: SolidJS-based web interface (`packages/web`) and
  Ink-based terminal UI (`packages/ink`, `packages/tui`).
- **Testing**: Bun's built-in test runner. Tests are always scoped —
  never run the global test suite.
- **Platform**: Windows is the primary development environment. Exit
  Code 1 from typecheck is expected behavior on error, not a system
  crash. Typecheck output MUST be captured in-memory, never dumped to
  temporary files.

## Development Workflow

All feature development follows a structured lifecycle:

1. **Specification** (`/speckit-specify`): Feature described in
   business terms, user scenarios defined, acceptance criteria set.
2. **Clarification** (`/speckit-clarify`): Ambiguities resolved through
   targeted questions.
3. **Planning** (`/speckit-plan`): Technical design, research, data
   model, and contract artifacts produced. Constitution Check gate
   applied before and after design.
4. **Task Generation** (`/speckit-tasks`): Actionable, dependency-ordered
   task list generated from design artifacts.
5. **Implementation** (`/speckit-implement`): Tasks executed in order
   with verification at each checkpoint.
6. **Verification**: Type checking, linting, and scoped tests after
   every modification. No exceptions.

**The Planning Mode Gate**: Implementation code MUST NOT be written
during the planning phase. The planning phase ends only with explicit
user approval. This is enforced at both the workflow level (speckit
execution gate) and the runtime level (plan permission mode restricts
write tools).

## Governance

This constitution supersedes all other development practices, style
guides, and ad-hoc conventions within the LiteAI project. Compliance
is mandatory for all contributions — human and AI-generated.

- **Amendment Process**: Any change to this constitution MUST be
  documented with a version bump, rationale, and sync impact report.
  Amendments require explicit approval before taking effect.
- **Versioning**: Constitution versions follow semantic versioning:
  - MAJOR: Backward-incompatible principle removals or redefinitions.
  - MINOR: New principles added or existing guidance materially expanded.
  - PATCH: Clarifications, wording fixes, non-semantic refinements.
- **Compliance Review**: All code changes, design artifacts, and
  workflow executions MUST be verified against the active constitution.
  The plan template includes a mandatory "Constitution Check" gate.
- **Guidance File**: Runtime development guidance is maintained in
  `AGENTS.md` at the project root and `.specify/memory/constitution.md`.
  Both MUST remain consistent.

**Version**: 1.0.0 | **Ratified**: 2026-05-19 | **Last Amended**: 2026-05-19
