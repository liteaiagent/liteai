# Implementation Plan: Agent Experience UI

**Branch**: `008-agent-experience-ui` | **Date**: 2026-04-19 | **Spec**: [spec.md](file:///c:/Users/aghassan/Documents/workspace/liteai/specs/008-agent-experience-ui/spec.md)  
**Input**: Feature specification from `/specs/008-agent-experience-ui/spec.md`

## Summary

Implement the full Agent Experience UI (Phase UI-B) by building:
1. A right-side **Agent Panel Drawer** that auto-opens on agent spawn and shows real-time agent status/progress rows
2. A **sidechain transcript viewer** inside the drawer for deep-diving into sub-agent activity
3. **Inline agent link/chip** in chat messages that opens the corresponding agent in the drawer
4. **Event subscription wiring** in the web host to bridge SSE events into the existing `ChatController.events` interface

All backend event infrastructure (agent lifecycle events + plan mode events + Bus→GlobalBus→SSE transport) is **already implemented**. This feature is primarily a frontend/UI effort with a single ~15-line backend adapter.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Bun 1.x runtime  
**Primary Dependencies**: SolidJS, Kobalte, Vanilla CSS (frontend), Hono SSE (transport, already wired)  
**Storage**: N/A — all state is in-memory reactive signals, sourced from SSE events  
**Testing**: Bun test (scoped to modified domains)  
**Target Platform**: Browser UI (desktop-first, side-drawer architecture)  
**Project Type**: Multi-tenant HTTP/SSE backend (core) + SolidJS web application (web/ui)  
**Performance Goals**: Agent panel open within 1 animation frame of `agent.spawned` event; zero flickering on rapid event bursts  
**Constraints**: Non-blocking SSE, strict event loop handling, controller abstraction must be preserved  
**Scale/Scope**: 3 new UI components, 1 adapter function, ~6 files total

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **✅ Mandate I (v-Next)**: No backward compatibility concerns — all new component code.
- **✅ Mandate II (Architecture & Performance)**: All state is session-scoped via SSE event filtering. No shared globals. Non-blocking reactive signals.
- **✅ Mandate III (Tech Stack)**: Using bun for all tooling. TypeScript strict mode. Scoped tests only.
- **✅ Mandate V (Design Guardrails)**: Incremental changes focused on the feature scope. No unprompted rewrites.
- **✅ Mandate VI (Fail-Fast)**: Event handler errors will be logged and surfaced. No silent fallbacks in state transitions.
- **✅ Mandate VIII (Design Protocol)**: Two design alternatives evaluated for both the panel UI pattern and the event wiring pattern (see ADR below). Right-side drawer selected as unambiguously optimal given spec requirements.
- **✅ Mandate IX (Planning Protocol)**: Plan produced before implementation.

## Architecture Decision Records

### ADR-001: Agent Panel UI Pattern

| Alternative | Pattern | Verdict |
|-------------|---------|---------|
| **A. Right-side slide-in drawer** | Drawer overlays/pushes chat content from the right edge | **✅ Selected** |
| B. Full-page panel with tab navigation | Route-based navigation to a dedicated agent view | ❌ Rejected — spec US2 requires "without navigating away" |
| C. Bottom sheet / inline accordion | Agent statuses embedded in the chat message timeline | ❌ Rejected — clutters timeline; spec names "Drawer" explicitly |

**Rationale**: Alternative A is unambiguously optimal because:
- US2 explicitly requires "without navigating away from the chat interface"
- US3 requires "drawer body swap" — implies a dedicated drawer container
- Existing `todo-panel-motion.stories.tsx` provides an animated drawer reference with spring physics
- The spec's key entities literally name "Agent Panel Drawer"

### ADR-002: Event Subscription Wiring Pattern

| Alternative | Pattern | Verdict |
|-------------|---------|---------|
| **A. Wire `ChatController.events` in `createWebChatController()`** | Bridge `useGlobalSDK().event` into the existing `ChatController.events` interface | **✅ Selected** |
| B. Create separate `useAgentEvents()` context | New SolidJS context that directly imports `useGlobalSDK` | ❌ Rejected — fragments event system; plan events already use `controller.events` |

**Rationale**: Alternative A preserves the controller abstraction, requires ~15 lines of adapter code, and maintains consistency with the already-wired plan event subscriptions in `chat-pane.tsx`.

## Project Structure

### Documentation (this feature)

```text
specs/008-agent-experience-ui/
├── plan.md              # This file
├── research.md          # Phase 0 — codebase investigation results
├── data-model.md        # Phase 1 — canonical event schemas + UI state entities
├── quickstart.md        # Phase 1 — verification steps
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
packages/core/src/
├── agent/
│   └── events.ts              # (EXISTING — AgentEvent definitions, no changes needed)
├── session/
│   ├── index.ts               # (EXISTING — Session.Event.PlanStateChanged/PlanApprovalRequested)
│   └── plan-mode-state.ts     # (EXISTING — PlanModeStateRef, emits PlanStateChanged)
└── bus/
    └── index.ts               # (EXISTING — Bus→GlobalBus bridge, all events reach SSE)

packages/web/src/context/
├── web-chat-controller.ts     # (MODIFY) Add events adapter bridging GlobalSDK emitter
└── global-sdk.tsx             # (EXISTING — createGlobalEmitter, SSE event ingestion)

packages/ui/src/
├── components/
│   ├── plan-approval-dock.tsx  # (EXISTING — PlanApprovalDock, no changes needed)
│   ├── plan-approval-dock.css  # (EXISTING)
│   └── agent-panel/            # (NEW — Agent Panel components)
│       ├── agent-panel.tsx     # Agent Panel Drawer wrapper
│       ├── agent-panel.css     # Drawer layout + animations
│       ├── agent-row.tsx       # Individual agent status row
│       ├── agent-row.css       # Agent row styling
│       ├── transcript-view.tsx # Sidechain transcript viewer
│       └── transcript-view.css # Transcript styling
├── message-parts/
│   └── tool.tsx               # (MODIFY) Extend task link to open Agent Panel drawer
└── panes/chat/
    ├── chat-pane.tsx           # (MODIFY) Add agent event subscriptions + AgentPanel mounting
    └── chat-prompt-input.tsx   # (EXISTING — plan lock already wired)
```

**Structure Decision**: New `agent-panel/` directory under `packages/ui/src/components/` groups all Agent Panel components cohesively. The web host adapter is a modification to the existing `web-chat-controller.ts`.

## Implementation Phases

> **Phase Mapping**: Plan phases (0–4) map to tasks.md phases as follows:
> Plan Phase 0 → Tasks Phase 2 (Foundational), Plan Phase 1 → Tasks Phase 4 (US2),
> Plan Phase 2 → Tasks Phase 5 (Inline Chip), Plan Phase 3 → Tasks Phase 6 (US3),
> Plan Phase 4 → Tasks Phase 7 (Polish). Tasks Phase 1 (Setup) and Phase 3 (US1 Verification) have no plan phase equivalent.

### Phase 0: Event Wiring (Blocking — enables all UI work)

1. **Wire `ChatController.events`** in `createWebChatController()` by bridging `useGlobalSDK().event` into a `subscribe(eventType, callback)` adapter. This unlocks all event subscriptions in UI components.

### Phase 1: Agent Panel Core (US2 — P1)

2. **Create `agent-panel/agent-row.tsx`** — individual agent status row component with status icon/chip (`running`/`completed`/`failed`/`killed`), activity text, and click handler.
3. **Create `agent-panel/agent-panel.tsx`** — drawer wrapper using spring-animated slide-in pattern (reference: `todo-panel-motion.stories.tsx`). Manages `AgentPanelState` reactive store.
4. **Wire agent event subscriptions** in `chat-pane.tsx` — subscribe to `agent.spawned`, `agent.progress`, `agent.completed`, `agent.terminal_notification`. Auto-open drawer on first spawn.
5. **Mount Agent Panel** in `chat-pane.tsx` layout.

### Phase 2: Inline Agent Chip (FR-006)

6. **Extend `message-parts/tool.tsx`** — for `task` tool parts, add an onClick handler that opens the Agent Panel drawer and highlights the corresponding agent row (in addition to existing session navigation).

### Phase 3: Transcript Viewer (US3 — P2)

7. **Create `agent-panel/transcript-view.tsx`** — sidechain transcript viewer component. Loads and renders the transcript for the selected agent.
8. **Wire drawer body swap** — clicking an agent row in the panel swaps the drawer body from agent-list view to transcript-view.

### Phase 4: Polish & Edge Cases

9. **Edge case: panel closed on agent complete** — animate/highlight the "explore agent" toggle button without auto-opening (EC-001).
10. **Edge case: error/backgrounded state** — show explicit error icon in agent row chip when `status === "failed"` (EC-002).
11. **Edge case: reconnection replay** — on SSE reconnect, fetch current agent state to restore the panel (EC-003). This uses the existing `controller.session.sync()` pattern.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A       | N/A        | N/A |
