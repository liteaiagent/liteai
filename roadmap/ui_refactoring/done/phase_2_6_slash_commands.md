# Phase 2.6: Full MVP Slash Command Architecture Port

**Target Package:** `@liteai/cli`
**Status:** Pending (To be executed in the next AI Agent session)

## 🚨 CORE MANDATE WARNING FOR NEXT AGENT 🚨
**DO NOT TAKE THE PATH OF LEAST RESISTANCE.** 
The previous agent attempted to build a "lean" version of the command palette using a simple `startsWith` filter to save time. This was explicitly REJECTED by the user. 
Your mandate is a **1:1 architectural port** of the MVP's sophisticated `useTypeahead` and `commandSuggestions.ts` feature set. 
- You MUST write high-quality, typed, and scalable code.
- You MUST port the exact capabilities of the MVP without cutting corners.
- Adhere strictly to the "core mandates": structural integrity > speed, explicit error handling, and strict TS typings.

## Architectural Objectives

The goal is to restore the advanced parsing, fuzzy search, categorization, and execution workflows of the MVP slash command system in the new React/Ink TUI.

### 1. Dependencies to Install
- You MUST install **`fuse.js`** in the `packages/cli` workspace. The MVP explicitly relied on `fuse.js` for weighted fuzzy searching (e.g., `commandName: 3`, `aliasKey: 2`). Do not attempt to rewrite this using `fuzzysort` or custom regex.

### 2. The 8 Mandatory MVP Features to Port
1. **Fuzzy Search & Aliases**: Match user input against command names, aliases, and descriptions using `fuse.js`.
2. **Usage Tracking & Categorization**: 
   - Port the MVP's `skillUsageTracking.ts` to persist usage scores to the local key-value store.
   - Categorize the dropdown into: Recently Used, Built-in, User, Project, and Policy.
3. **Mid-Sentence Triggers**: Port `findMidInputSlashCommand` so `/` commands can be triggered anywhere in the input stream, not just at index 0.
4. **Auto-Execution**: Instantly submit the command if the selected command takes 0 arguments (e.g., `/voice-memo`).
5. **Command Name Ghost Text**: Port `getBestCommandMatch` to show inline ghost text completions for command names.
6. **Argument Directory/File Hinting**: 
   - Port the MVP's `getDirectoryCompletions` and `getPathCompletions`.
   - If the user types a command that accepts paths (e.g., `/add-dir `), the dropdown MUST dynamically switch to showing file/directory autocomplete suggestions.
7. **Syntax Highlighting**: Integrate `findSlashCommandPositions` into the TUI highlighters so `/command` tokens are highlighted anywhere in the prompt text.
8. **TUI-Only Interactive Commands (`/models`, `/mcp`, etc.)**:
   - The MVP featured interactive UI commands that opened dialogs rather than sending text to the LLM backend.
   - You must explicitly inject `/models`, `/mcp`, and any other frontend-specific commands into the typeahead pool.
   - When a user selects `/models` or `/mcp`, you must intercept the `onSubmit` handler in `PromptInput` to open the respective React Dialog components instead of pushing the string to the Chat loop.

### 3. Implementation Steps
1. **Analyze MVP Sources**: Review `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\utils\suggestions\commandSuggestions.ts` and `hooks\useTypeahead.tsx`.
2. **Setup Dependencies**: Run `bun add fuse.js` in `packages/cli`.
3. **Port Logic**: Create `src/tui/components/prompt/utils/command-suggestions.ts` and port the Fuse setup, parsing, and suggestion logic.
4. **Wire Hook**: Heavily refactor `useCommandSuggestions.ts` to handle fuzzy searching, categories, and directory autocompletion depending on the cursor context.
5. **Refine UI**: Update `PromptCommandSuggestions` to handle aliases (displaying them dynamically) and visually segment categories if necessary.
6. **Intercept Actions**: Update `PromptInput` to correctly handle auto-execution, argument injection, and TUI-only Dialog triggers (`/models`, `/mcp`).

## Verification
- Before submitting the final code, ensure `bun typecheck` and `bun lint:fix` return 0 errors.
- Ensure all React Hooks are used safely (no conditional hooks, proper dependency arrays).
