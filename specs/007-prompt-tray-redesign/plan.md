# Implementation Plan: prompt-tray-redesign

**Branch**: `007-prompt-tray-redesign` | **Date**: 2026-04-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/007-prompt-tray-redesign/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

The prompt tray's single agent dropdown will be decomposed into 4 independent controls spanning agent identity, session operations, tool availability, and spawning optimizations. This directly mirrors the MVP features by placing plan mode as a controllable user configuration alongside standard chat.

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.x runtime
**Primary Dependencies**: SolidJS, Kobalte (for UI), Drizzle ORM (for backend SQLite storage)
**Storage**: SQLite (via drizzle)
**Testing**: bun test
**Target Platform**: Desktop Browser & Local Server
**Project Type**: Full-stack multi-package typescript application
**Performance Goals**: UI updates should maintain sub-16ms layout shifts, backend configuration updates should be synchronous and fast.
**Constraints**: Fork optimization toggle assumes that `Fork` strategy respects system environment.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Major Release Rule**: Breaking backward compatibility is acceptable. Persona-swap code is already removed by the pre-requisite plan-mode-mvp-parity-rfc.
- **Strict Error Handling**: Errors reading or writing session configs should throw explicitly. 

## Project Structure

### Documentation (this feature)

```text
specs/007-prompt-tray-redesign/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
packages/core/
├── src/
│   ├── session/
│   │   ├── session.sql.ts
│   │   ├── engine/
│   │   │   └── query.ts
│   └── tool/
│       └── registry.ts
packages/ui/
├── src/
│   └── panes/
│       └── chat/
│           ├── chat-prompt-input.tsx
│           ├── session-mode-selector.tsx
│           ├── tool-profile-selector.tsx
│           └── fork-toggle.tsx
packages/web/
├── src/
│   └── components/
│       └── settings-agents.tsx
```

**Structure Decision**: The redesign introduces multiple UI elements natively nested inside `packages/ui/src/panes/chat`. The backend logic requires updating the session persistence schemas primarily accessed in `packages/core/src/session/`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Multiple Selectors | Accommodate the different axes of execution | Single dropdown failed to capture orthogonal session configurations like mode vs optimizations |
