# Research & Decisions: Phase UI-A (Minimal)

## Framework & UI Library
**Decision**: SolidJS + Kobalte  
**Rationale**: Hard-mandated by `agents-core-roadmap.md`. No alternatives considered to maintain project architectural consistency.

## Styling
**Decision**: Vanilla CSS  
**Rationale**: Hard-mandated by `agents-core-roadmap.md`. Avoid tailwind and specialized CSS-in-JS frameworks per overarching architecture.

## Reference Architecture
**Decision**: Adapt patterns from `liteai_cli_mvp` Ink/React TUI to SolidJS  
**Rationale**: Required by the *Reference Implementation Mandate* in the core roadmap to ensure identical mental models and behavioral parity.

**Note**: Since all major technical choices are locked by the roadmap and confirmed via the `/speckit.clarify` step, there were no unresolved `NEEDS CLARIFICATION` items prompting further exploratory research.
