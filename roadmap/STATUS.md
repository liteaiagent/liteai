# LiteAI — Project Status

> **Single source of truth** for spec completion and roadmap progress.
> Last updated: 2026-05-22

---

## Legend

| Icon | Meaning |
|------|---------|
| ✅ | Done |
| 🔄 | In progress |
| 📋 | Spec complete, tasks not yet generated |
| 📝 | Draft / not started |
| ⬜ | Design doc not yet written |
| — | No spec / no roadmap phase |

---

## Spec Completion Index

All implemented features live in `specs/`. Each spec has a measurable task completion status.

| # | Spec | Title | Tasks | Status | Roadmap Phase |
|---|------|-------|-------|--------|---------------|
| 001 | [unified-system-prompt](../specs/001-unified-system-prompt/) | Unified System Prompt Resolution | 49/49 | ✅ Done | P4 (Prompt Rewrites) |
| 002 | [subagent-architecture](../specs/002-subagent-architecture/) | Sub-Agent Architecture | 79/79 | ✅ Done | — |
| 003 | [fork-subagent-durability](../specs/003-fork-subagent-durability/) | Fork Subagent + Agent Durability | 37/37 | ✅ Done | — |
| 004 | [plan-mode](../specs/004-plan-mode/) | Plan Mode | 55/55 | ✅ Done | — (superseded by 006) |
| 005 | [plan-mode-ui-minimal](../specs/005-plan-mode-ui-minimal/) | Minimal Plan Mode UI | 17/17 | ✅ Done | — |
| 006 | [plan-mode-mvp-parity](../specs/006-plan-mode-mvp-parity/) | Plan Mode MVP Parity | — | 📝 Draft | P2 (conceptually) |
| 007 | [prompt-tray-redesign](../specs/007-prompt-tray-redesign/) | Prompt Tray Redesign | 13/13 | ✅ Done | TUI Overhaul |
| 008 | [agent-experience-ui](../specs/008-agent-experience-ui/) | Agent Experience UI | 14/21 (67%) | 🔄 In Progress | TUI Overhaul |
| 009 | [engine-loop-decoupling](../specs/009-engine-loop-decoupling/) | Engine Loop Decoupling | 19/19 | ✅ Done | — |
| 010 | [subagent-result-flow](../specs/010-subagent-result-flow/) | Subagent Result Flow | 10/10 | ✅ Done | — |
| 011 | [backward-execution](../specs/011-backward-execution/) | Backward Execution & Step-Level Control | 31/31 | ✅ Done | — |
| 012 | [agent-taxonomy-rename](../specs/012-agent-taxonomy-rename/) | Agent Taxonomy & Rename | 55/55 | ✅ Done | P1 |
| 013 | [plan-mode-lifecycle](../specs/013-plan-mode-lifecycle/) | Plan Mode Lifecycle | 34/35 (97%) | 🔄 In Progress | P2 |
| 014 | [yield-turn-removal](../specs/014-yield-turn-removal/) | yield_turn Removal & State Cleanup | 29/29 | ✅ Done | P3 |
| 015 | [subagent-async-dispatch](../specs/015-subagent-async-dispatch/) | Async Subagent Dispatch | 35/35 | ✅ Done | — |
| 016 | [message-rendering](../specs/016-message-rendering/) | Message Rendering & Error Resilience | — | 📋 Spec Complete | TUI Overhaul Phase 6 |

---

## Core Roadmap Phase Status

Phases from the [master roadmap](./core-roadmap/00-roadmap.md). Phases P1–P4 are complete. P5 is next.

| Phase | Name | Design Doc | Spec | Status |
|-------|------|------------|------|--------|
| **P1** | Agent Taxonomy & Rename | [01](./core-roadmap/01-agent-taxonomy.md) ✅ | [012](../specs/012-agent-taxonomy-rename/) ✅ | ✅ Done |
| **P2** | Plan Mode Lifecycle | [02](./core-roadmap/02-plan-mode.md) ✅ | [013](../specs/013-plan-mode-lifecycle/) 🔄 | ✅ Done |
| **P3** | yield_turn Removal | [02 §3](./core-roadmap/02-plan-mode.md) ✅ | [014](../specs/014-yield-turn-removal/) ✅ | ✅ Done |
| **P4** | Prompt Rewrites | [02 §4](./core-roadmap/02-plan-mode.md) ✅ | [001](../specs/001-unified-system-prompt/) ✅ | ✅ Done |
| **P5** | Tool Concurrency Redesign | [03](./core-roadmap/03-tool-concurrency.md) ✅ | — | ⏳ **Next** |
| **P6** | KV Cache Hardening | [04](./core-roadmap/04-kv-cache.md) ✅ | — | ⏳ Blocked on P5 |
| **P7** | Skill System Enhancements | [05](./core-roadmap/05-skills.md) ✅ | — | ⏳ Ready |
| **P8** | Verification & Polish | (inline) | — | ⏳ Final |
| **P9** | Guide Agent | ⬜ | — | ⏳ Blocked on P4 |
| **P10A** | Project Registry | ⬜ | — | ⏳ Blocked on P4 |
| **P10B** | Unified Memory System | ⬜ | — | ⏳ Blocked on P10A |
| **P10C** | Memory Tools & Integration | ⬜ | — | ⏳ Blocked on P10B |
| **P11A** | Summarization Pipeline | ⬜ | — | ⏳ Blocked on P10C |
| **P11B** | History Index & Injection | ⬜ | — | ⏳ Blocked on P11A |
| **P11C** | Full Conversation Recall | ⬜ | — | ⏳ Blocked on P11B |
| **P12A** | In-Session Memory Extraction | ⬜ | — | ⏳ Blocked on P10C+P6 |
| **P12B** | Post-Session Skills Extraction | ⬜ | — | ⏳ Blocked on P12A |
| **P12C** | Skills Inbox CLI | ⬜ | — | ⏳ Blocked on P12B |
| **P13A** | Context Instructions v2 | ⬜ | — | ⏳ Blocked on P11C |
| **P13B** | Session Export | ⬜ | — | ⏳ Blocked on P11C |
| **P13C** | Content Replacement | ⬜ | — | ⏳ Blocked on P11C |
| **P14** | Container Architecture | — | — | ⏳ Deferred |

---

## TUI Overhaul (Separate Track)

Tracked in [tui-overhaul/roadmap.md](./tui-overhaul/roadmap.md). Related specs:

| Phase | Spec | Status |
|-------|------|--------|
| Phase 3 | [007-prompt-tray-redesign](../specs/007-prompt-tray-redesign/) | ✅ Done |
| Phase 4–5 | [008-agent-experience-ui](../specs/008-agent-experience-ui/) | 🔄 In Progress (67%) |
| Phase 6 | [016-message-rendering](../specs/016-message-rendering/) | 📋 Spec Complete |

---

## Active Work

Items currently in progress or immediately next:

1. 🔄 **008-agent-experience-ui** — 67% complete (14/21 tasks)
2. 🔄 **013-plan-mode-lifecycle** — 97% complete (34/35 tasks)
3. 📋 **016-message-rendering** — Spec complete, needs task generation
4. ⏳ **P5: Tool Concurrency Redesign** — Next core roadmap phase (design doc ready)

---

## Directory Structure

```text
roadmap/
├── STATUS.md              ← YOU ARE HERE (single source of truth)
├── roadmap.json           ← Active roadmap pointer
├── core-roadmap/          ← Master roadmap + design docs (P1–P14)
│   ├── 00-roadmap.md      ← Master phase table + dependency graph
│   ├── 01–05 + ADR        ← Written design documents
│   └── 06–12              ← NOT YET WRITTEN (future phases)
├── tui-overhaul/          ← Separate TUI roadmap (Phases 1–6)
├── reference/             ← Feature status audits (read-only reference)
│   ├── core_features/
│   └── ui_features/
├── tracks/                ← Product tracks (separate from core roadmap)
│   ├── ai-tutor-platform/
│   ├── hosted-language-proxy/
│   └── liteagent-framework/
├── archive/               ← Completed/superseded roadmap items
│   ├── agents-platform-roadmap.md
│   ├── project-scoped-persistence/
│   ├── cli-core-imports/
│   ├── tui-improvement/
│   └── ui_refactoring/
├── done/                  ← Completed work archive
├── quota-tracking.md
└── thinking_loop_analysis.md
```
