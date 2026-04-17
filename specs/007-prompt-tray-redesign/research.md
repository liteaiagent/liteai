# Research: prompt-tray-redesign

## Unknowns Addressed

No critical technical unknowns were identified during the specification phase. The architectural paths for session persistence and UI development are well-established.

## Design Decisions

1. **Session Configuration Persistence**
   - **Decision**: Extend `SessionConfig` / `SessionTable` schema fields to store `session_mode`, `tool_profile`, and `fork_enabled`.
   - **Rationale**: Keeps configuration closely tied to the specific chat session state and ensures immediate restoration across refreshes. The SQLite ORM handles these natively via typed JSON blocks or standard columns.
   - **Alternatives considered**: Passing this strictly as an in-memory client state or saving globally in `UserPreferences`. Global state was rejected because users need per-session configuration granularity (e.g., fast mode locally for simple questions but plan mode for large tasks).

2. **Frontend UI Architecture**
   - **Decision**: Develop separate functional granular components using SolidJS (`session-mode-selector.tsx`, `tool-profile-selector.tsx`, `fork-toggle.tsx`) and inject them into `chat-prompt-input.tsx`.
   - **Rationale**: Adheres to Single Responsibility Principle, making UI maintainable.
   - **Alternatives considered**: Bundling all configurations into a single giant form or dropdown pane. Rejected because one of the primary drivers of this RFC is to decompose a multi-axis choice into flat, independently accessible single-click indicators on the tray level.

3. **Backend Tool Filtering**
   - **Decision**: Dynamically modify the `ToolRegistry` or the `SessionEngine` injection loop to check the state of the active `ToolProfile`. If `ToolProfile === 'Fast'`, `EnterPlanModeTool` and subagents are excluded from tool list generation.
   - **Rationale**: Follows standard dependency injection logic; securely prevents LLMs from hallucinating access to blocked capabilities.
   - **Alternatives considered**: Hard-coding tool blocking as a generic system prompt exclusion. Rejected because system prompting doesn't prevent LLMs from requesting function calls that are defined in its schema definition.
