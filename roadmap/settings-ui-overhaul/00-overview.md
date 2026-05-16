# Settings UI Overhaul — Master Plan

> **Status**: Proposed  
> **Priority**: P0 (Blocking — TUI is non-functional for slash commands)  
> **Scope**: `packages/cli/src/tui/`  
> **Related Conversations**: `3c7f0cae` (Removing Home Page), `812f9e7f` (Migrating Modals), `f04606cb` (Configuring Providers)

---

## Problem Statement

After removing the `HomeRoute` and refactoring settings to use a Claude Code-style modal pane architecture, **the TUI is broken**:

1. **`/models` shows nothing** — the modal content is set in context but has no rendering slot in `BlankSession`
2. **Input becomes dead** — `isDialogOpen` disables the prompt's `useInput` but nothing takes over
3. **Focus management is structurally flawed** — multiple competing `useInput` hooks with fragile `isActive` flags

## Root Cause (TL;DR)

The architecture has **three fatal structural bugs**:

| # | Bug | Location | Impact |
|---|-----|----------|--------|
| 1 | **BlankSession has no modal rendering slot** | `app.tsx:66-108` | `/models` opens a modal that never renders. Input disabled, user stuck. |
| 2 | **Dual `useInput` conflict** | `base-text-input.tsx` + `dialog-select.tsx` | Both register `useInput` — the keybinding system and the TextInput fight for keystrokes |
| 3 | **No unified focus owner** | Across all modal dialogs | No single authority decides "who owns input right now" |

## Document Index

| Doc | Title | Purpose |
|-----|-------|---------|
| [01-architecture-audit](./01-architecture-audit.md) | Architecture Comparison | Deep analysis of Claude Code vs Gemini CLI vs LiteAI architectures |
| [02-root-cause-analysis](./02-root-cause-analysis.md) | Root Cause Analysis | Detailed bug chain and failure modes |
| [03-design-proposal](./03-design-proposal.md) | Design Proposal & Alternatives | Two design alternatives with tradeoff analysis |
| [04-implementation-plan](./04-implementation-plan.md) | Implementation Plan | File-by-file changes, ordered by dependency |
| [05-verification-plan](./05-verification-plan.md) | Verification Plan | Test matrix and manual validation checklist |

## Decision Gate

> [!IMPORTANT]
> Per Mandate §7, this plan presents **two design alternatives** in [03-design-proposal](./03-design-proposal.md).
> User must select an approach before implementation begins.
