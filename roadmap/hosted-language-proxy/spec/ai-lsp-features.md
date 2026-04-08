# AI-Augmented LSP Features — Native Editor Intelligence

> **Goal:** Extend the existing LSP server (`lsp-handler.ts`) beyond inline completions to deliver AI-powered code intelligence directly through native VSCode UI — hover cards, lightbulbs, diagnostics, code lens, and the outline view.

---

## Context

The LiteAI VSCode extension currently implements a minimal LSP server with two capabilities:

1. **`textDocumentSync` (Incremental)** — Tracks document lifecycle events (open, change, close) asynchronously to maintain an up-to-date buffer representation without full-document transfer on every keystroke.
2. **`inlineCompletionProvider`** — Triggers on text changes, pulls prefix (last 100 lines) and suffix (first 20 lines) around the cursor, and queries a small AI model for fill-in-the-middle ghost-text completions.

All other AI interactions currently flow through the webview chat UI. This spec proposes surfacing AI intelligence through **native LSP hooks** so the experience feels built into the editor, not bolted on.

> [!IMPORTANT]
> This spec describes **AI-generated** features injected via the LSP server. It is entirely distinct from the [Language Capability Proxy](./language-capability-proxy.md), which forwards results from VSCode's own language extensions (TypeScript, Pylance, etc.) to Core's AI tools.

---

## Proposed Features

### Standard Completions (`completionProvider`)
The classic Intellisense dropdown menu, as opposed to inline ghost text. AI-generated suggestions would appear alongside native completions in the standard completion widget.

**Use cases:**
- AI-suggested function/method completions with full signatures
- Context-aware import suggestions
- AI-generated snippet completions

### Hover Information (`hoverProvider`)
AI-generated code explanations rendered in the native hover card when hovering over a function, class, or variable.

**Use cases:**
- Natural-language summaries of complex functions
- Dependency/usage context ("This is called from 3 places...")
- Security or performance annotations

### Code Actions / Quick Fixes (`codeActionProvider`)
Lightbulb actions offering AI-powered refactoring, bug fixes, or docstring generation for the selected code block.

**Use cases:**
- "Refactor with LiteAI" — restructure selected code
- "Generate docstring" — auto-document a function
- "Fix this issue" — AI quick-fix for diagnostic errors
- "Explain this error" — natural-language explanation

### AI Diagnostics (`diagnosticProvider`)
Background AI analysis pass that surfaces inline warnings for potential logic bugs, security issues, or anti-patterns — separate from the compiler's own diagnostics.

**Use cases:**
- Logic bug detection (e.g., off-by-one, null dereference paths)
- Security issue flagging (e.g., unsanitized input)
- Performance anti-pattern warnings
- Style/best-practice suggestions beyond what linters catch

> [!WARNING]
> AI diagnostics must be clearly distinguished from native compiler/linter diagnostics. Use a dedicated diagnostic source name (e.g., `"liteai"`) to avoid confusion.

### Code Lens (`codeLensProvider`)
Actionable inline text placed above functions or classes — e.g., "Refactor with LiteAI", "Generate Tests", "Explain".

**Use cases:**
- "Generate Tests" above every exported function
- "Refactor" for complex methods
- "Explain" for unfamiliar code sections
- Test coverage indicators

### Document Symbols (`documentSymbolProvider`)
AI-enhanced outline view — standard symbol detection augmented with AI-generated groupings or annotations.

**Use cases:**
- Semantic grouping of related symbols
- Complexity annotations in the outline

---

## Architecture

These features are served by Core's existing **LSP server** (`lsp-handler.ts`), which communicates over stdio with the VSCode extension. They are **not** part of the HostedCapabilities proxy pattern — they are outbound AI intelligence, not inbound IDE data forwarding.

```
┌─────────────────────────┐     stdio      ┌─────────────────────────────┐
│   VSCode Editor UI      │ ◀────────────▶ │   LiteAI LSP Server         │
│   (hover, lightbulbs,   │                │   (lsp-handler.ts)          │
│    diagnostics, lens)   │                │   ┌─────────────────────┐   │
│                         │                │   │ AI Model Provider   │   │
│                         │                │   └─────────────────────┘   │
└─────────────────────────┘                └─────────────────────────────┘
```

---

## Priority & Phasing

| Phase | Feature | Priority | Rationale |
|-------|---------|:--------:|-----------|
| 1 | `completionProvider` (standard dropdown) | High | Direct complement to existing inline completions |
| 2 | `codeActionProvider` (lightbulbs) | High | Highest user-visible impact — "Fix", "Refactor", "Explain" |
| 3 | `codeLensProvider` | Medium | "Generate Tests" / "Explain" above functions |
| 4 | `hoverProvider` (AI explanations) | Medium | Enhances code comprehension |
| 5 | `diagnosticProvider` (AI analysis) | Low | Requires careful UX to avoid noise |
| 6 | `documentSymbolProvider` | Low | Marginal benefit over native symbols |

---

## Relationship to Other Specs

- **[Language Capability Proxy](./language-capability-proxy.md):** Proxies **native VSCode language results** (TypeScript diagnostics, go-to-definition, etc.) to Core's AI tools. This spec is the **reverse direction** — Core's AI pushing intelligence into native editor UI.
- **LSP Handler (`lsp-handler.ts`):** The existing implementation. All features in this spec extend it with additional LSP capabilities.
