# Phase 4 — Open Questions & Design Decisions

> [!NOTE]
> This document captures analysis notes and resolved decisions from Phase 4 planning.
> The implementation plan is a separate, pure-execution document.

---

## Q1: Context Visualization — Token Category Source ✅ RESOLVED

**Decision**: Implement static category estimation in `packages/core` as a new server endpoint. This avoids duplicating the logic across CLI, Web, and VSCode UIs.

The core already has access to all the data sources needed:
- `SystemPrompt.resolveSystemPromptSections()` → system prompt parts (can estimate token count)
- `resolveTools()` → resolved tool definitions (can count enabled tools)
- Agent context → `Agent.get()` gives agent instructions
- MCP servers → tool list is available via the MCP subsystem
- Message history → already in `Session.messages()`

**Implementation**: New `GET /session/:id/context` endpoint in core that returns a `ContextBreakdown` object with static category estimates. All UIs consume the same API.

---

## Q2: Rewind Viewer — Cross-Session Search ✅ RESOLVED

**Decision**: Defer cross-session search to Phase 5/6.

**Rationale**: With multiple UIs (CLI, Web, VSCode), the search must be a core API endpoint — not client-side JSONL parsing. This requires:
1. New core route: `GET /session/search?q=` with full-text search across messages
2. Optional: SQLite FTS5 virtual table for efficient text search
3. JSONL sidechain files would need to be indexed or query-accessible

This is a significant core infrastructure change that benefits all UIs equally but is outside Phase 4's scope of TUI specialized views.

---

## Q3: Session Browser — Preview Content ✅ RESOLVED

**Decision**: Generate AI session description (not first-message preview) following Claude Code and Gemini CLI pattern.

Both Claude Code and Gemini CLI generate a short AI-written summary describing what the session accomplished, similar to how LiteAI already generates session titles via `ensureTitle()` in `tasks/title.ts`.

**Implementation**: New `tasks/description.ts` in core using the same fire-and-forget pattern as `ensureTitle()`:
- Triggered after the first assistant response completes (alongside title generation)
- Uses the small model (same as title)
- Generates a 1-2 sentence description of the conversation's purpose
- Stored in `Session.Info.description` (new field)
- All UIs read it via the existing session API

---

## Q4: `/compact` Command Registration ✅ RESOLVED

**Decision**: Register `/compact` as a TUI interceptor that directly calls the `summarize` API endpoint. Also register in `tuiCommands` for suggestion/autocomplete.
