- [ ] Persistent server option (keep running after VSCode closes)
- [ ] TracePane extraction
- [ ] SettingsPane extraction
- [ ] LSP proxy via Extension Server — proxy core's LSP queries (diagnostics, references, definitions, hover, symbols) through `vscode.languages.*` API instead of spawning duplicate language servers. Core's LSP client engine is currently disabled in hosted mode; this would re-enable code intelligence for the LLM by forwarding to VSCode's built-in servers.
---
Implemented Features (Phase 1)
Currently, a very minimal set of LSP capabilities is implemented. The focus is strictly on enabling AI-driven inline completions over standard stdio:

textDocumentSync (Incremental):
Tracks document lifecycle events (open, change, close) asynchronously to keep an up-to-date representation of what the user is editing in their workspace without sending the full document text on every keystroke.
inlineCompletionProvider:
An implementation of the VS Code proposed inline completions feature (ghost text). It triggers on text document changes, pulls the prefix (last 100 lines) and suffix (first 20 lines) around the cursor, and queries the configured small AI model to generate "fill-in-the-middle" code completions.
Remaining / Unimplemented Features
The Language Server Protocol has a vast array of capabilities. Depending on the goals for "LiteAI", here are typical AI-assisted or standard language server features that are not yet implemented:

Standard Completions (completionProvider): The classic intellisense dropdown menu (as opposed to inline ghost text).
Hover Information (hoverProvider): AI-generated code explanations when hovering over a function, class, or variable.
Code Actions / Quick Fixes (codeActionProvider): Lightbulbs that can offer AI refactoring, bug fixes, or generating docstrings for a specific block of code.
Diagnostics (diagnosticProvider): Ability to show inline errors or warnings (e.g., an AI background pass that flags potential logic bugs or security issues).
Document Formatting (documentFormattingProvider): Using the AI to format or standardize a block of code.
Semantic Analysis:
definitionProvider / declarationProvider
referencesProvider
documentSymbolProvider (to power the code outline)
Code Lens (codeLensProvider): Actionable text placed inline with the code (e.g., above functions saying "Refactor with LiteAI" or "Generate Tests").
Workspace Support: Features like workspaceSymbolProvider or workspace-level file operations.
Summary: The LSP integration is strictly acting as an engine for the "AI inline completions" feature and basic document synchronization. All other code intelligence and AI integrations are currently handled out-of-band via the webview/chat UI rather than native LSP hooks.
