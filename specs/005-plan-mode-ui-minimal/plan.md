# Implementation Plan: Phase UI-A (Minimal Plan Mode UI)

**Branch**: `[005-plan-mode-ui-minimal]` | **Date**: 2026-04-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/005-plan-mode-ui-minimal/spec.md`

## Summary

Implement the Phase UI-A Minimal Plan Mode UI. This includes updating the chat prompt input to lock when approval is requested, rendering a sticky Plan Approval Dock using SolidJS + Kobalte + vanilla CSS, and showing a plan mode badge in the session title bar.

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.x runtime (for both build tools and typing)  
**Primary Dependencies**: SolidJS, Kobalte, vanilla CSS  
**Storage**: N/A  
**Testing**: Scoped UI tests (if applicable)  
**Target Platform**: Web Browser / VSCode Webview  
**Project Type**: web-ui (packages/ui)  
**Performance Goals**: Fluid UI transition when receiving SSE events  
**Constraints**: Behavioral Parity with MVP TUI (`liteai_cli_mvp/src`). No behavioral degradation.  
**Scale/Scope**: UI components in `packages/ui` for Chat Pane  

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Tech Stack**: Follows `bun` usage policy (Principle III)
- **Error Handling**: Follows strict fail-fast if SSE events are malformed (Principle VI)
- **Design Guardrails**: Deeply focused on just the Minimal UI-A as specified (Principle V)
- **Backward Compatibility**: N/A (new feature set)

No violations detected.

## Project Structure

### Documentation (this feature)

```text
specs/005-plan-mode-ui-minimal/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
└── tasks.md             # Phase 2 output (future step)
```

### Source Code (repository root)

```text
packages/ui/
├── src/
│   ├── components/
│   │   ├── plan-approval-dock.tsx
│   │   └── plan-approval-dock.css
│   └── panes/
│       └── chat/
│           ├── chat-pane.tsx
│           ├── chat-prompt-input.tsx
│           └── session-title-bar.tsx
```

**Structure Decision**: Code lives exclusively in `packages/ui` as specified by the agents-core-roadmap.md.
