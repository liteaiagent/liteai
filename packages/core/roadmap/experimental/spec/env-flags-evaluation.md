## Feature Breakdown & Value Assessment

### 1. Remove `LITEAI_EXPERIMENTAL` master flag
**What it does:** A global toggle that, when enabled, cascades to activate several sub-features (icon discovery, oxfmt, workspaces). It exists purely as a convenience for internal testing.

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | 🟢 High | Eliminates a fragile implicit coupling — sub-features should be independently toggled. Reduces complexity in `flag.ts`. |
| **UI/UX** | ⚪ None | Invisible to users. |

---

### 2. Promote `EXPERIMENTAL_FILEWATCHER`
**What it does:** When enabled, subscribes [watcher.ts:78](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/file/watcher.ts#L78) to the full project directory using a Parcel watcher, enabling real-time file change detection (new files, modifications, deletions).

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | 🟢 High | Core infrastructure — enables reactive file indexing, context freshness, and auto-refresh of project state. Without this, the agent operates on stale snapshots. |
| **UI/UX** | 🟡 Medium | Users indirectly benefit: the agent sees their file changes in real-time instead of requiring manual re-indexing. But it's not a visible UI feature. |

---

### 3. Rename `DISABLE_FILEWATCHER`
**What it does:** Kill switch to completely disable file watching (the inverse of #2). Needed for environments where file watching is problematic (e.g., network mounts, CI).

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | 🟡 Medium | Operational necessity — pure rename, no behavior change. But having a clean non-experimental name improves DX for deployments. |
| **UI/UX** | ⚪ None | Internal config knob. |

---

### 4. Promote `EXPERIMENTAL_ICON_DISCOVERY`
**What it does:** Automatically scans the project root for `favicon.*` files and sets them as the project icon in [project.ts:311](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/project/project.ts#L311). If found, the project gets a visual identity without manual config.

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | 🔴 Low | Trivial — one `discover()` call at project init. Minimal architectural impact. |
| **UI/UX** | 🟡 Medium | Nice QoL — projects automatically get their favicon displayed in the UI. Makes multi-project setups visually distinguishable. But it's a polish feature, not functionality. |

---

### 5. Rename `DISABLE_COPY_ON_SELECT`
**What it does:** On Windows, disables the default terminal behavior of copying text to clipboard when you select it in the TUI. Prevents accidental clipboard overwrites during code review.

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | ⚪ None | Pure frontend/TUI behavior. |
| **UI/UX** | 🟡 Medium | Real usability issue on Windows — accidental copy-on-select is a known pain point. The rename makes it discoverable as a stable config option. |

---

### 6. Rename `BASH_TIMEOUT_MS`
**What it does:** Overrides the default timeout (120s) for bash/shell commands executed by the `run_command` tool in [run_command.ts:20](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/tool/run_command.ts#L20).

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | 🟡 Medium | Important for production tuning — long-running builds, test suites, etc. need configurable timeouts. Rename makes it a first-class config. |
| **UI/UX** | 🔴 Low | Users won't interact with this directly, but they'll notice if their commands time out prematurely. |

---

### 7. Rename `OUTPUT_TOKEN_MAX`
**What it does:** Caps the maximum output tokens sent to the LLM provider per request in [options.ts:8](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/provider/transform/options.ts#L8). Default: 32,000 tokens.

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | 🟢 High | Directly affects cost, latency, and response quality. A critical tuning knob for production deployments, especially multi-tenant. |
| **UI/UX** | 🔴 Low | Invisible to users unless they notice truncated responses. |

---

### 8. Promote `EXPERIMENTAL_OXFMT`
**What it does:** Enables `oxfmt` (a Rust-based formatter) as an auto-detected code formatting option alongside Prettier and Biome in [formatter.ts:94](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/format/formatter.ts#L94).

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | 🟡 Medium | Expands formatter ecosystem support. Auto-detection aligns with existing Biome/Prettier pattern — architectural consistency. |
| **UI/UX** | 🔴 Low | Users who use oxfmt will get correct formatting instead of fallback. Niche audience. |

---

### 9. Promote `EXPERIMENTAL_LSP_TY`
**What it does:** Switches the Python LSP server from Pyright to `ty` (Astral's new Rust-based Python type checker). Currently an env-flag toggle in [lsp/index.ts:80](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/lsp/index.ts#L80); promotion means moving to a config-driven `lsp.server` selection.

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | 🟢 High | Architecture improvement — moving from a boolean flag to config-driven LSP server selection is a clean extensibility pattern. Supports future LSP servers without new flags. |
| **UI/UX** | 🟡 Medium | Python developers get better diagnostics, faster type checking. `ty` is significantly faster than Pyright. Directly improves perceived responsiveness. |

---

### 10. Promote `EXPERIMENTAL_WORKSPACES`
**What it does:** Enables the workspace routing middleware in [workspace-router-middleware.ts:40](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/control-plane/workspace-router-middleware.ts#L40), allowing multi-instance request proxying — a single control plane can route requests to multiple LiteAI instances (one per workspace). Also gates workspace UI in the CLI header.

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | 🟢 High | **Core multi-tenant architecture.** This is foundational for the control plane. Without it, you can't run multiple project instances behind a single entrypoint. |
| **UI/UX** | 🟢 High | Users can switch between workspaces in the TUI header, see workspace list, and manage multiple projects in one session. Major ergonomic improvement for power users. |

---

### 11. Promote `EXPERIMENTAL_MARKDOWN`
**What it does:** Renders markdown formatting (bold, code blocks, lists, etc.) in the CLI TUI message output instead of raw text. Already defaults to `true`.

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | ⚪ None | Pure UI rendering concern. |
| **UI/UX** | 🟢 High | **Critical for readability.** Without markdown rendering, LLM responses display as unformatted walls of text. Already default-on, so this is just cleanup. |

---

### 12. Rename `ENABLE_ALPHA_MODELS`
**What it does:** When enabled, alpha/preview models (e.g., early access GPT/Claude variants) appear in the model selection list in [state.ts:386](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/provider/state.ts#L386).

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| **Backend** | 🔴 Low | Simple filter toggle — no architectural impact. |
| **UI/UX** | 🟡 Medium | Power users and early adopters want access to bleeding-edge models. The rename from "experimental" to "alpha" also sets better user expectations about stability. |

---

## Summary Matrix

| # | Feature | Backend | UI/UX |
|---|---------|---------|-------|
| 1 | Remove master flag | 🟢 High | ⚪ None |
| 2 | Promote Filewatcher | 🟢 High | 🟡 Medium |
| 3 | Rename Disable Filewatcher | 🟡 Medium | ⚪ None |
| 4 | Promote Icon Discovery | 🔴 Low | 🟡 Medium |
| 5 | Rename Disable Copy-on-Select | ⚪ None | 🟡 Medium |
| 6 | Rename Bash Timeout | 🟡 Medium | 🔴 Low |
| 7 | Rename Output Token Max | 🟢 High | 🔴 Low |
| 8 | Promote Oxfmt | 🟡 Medium | 🔴 Low |
| 9 | Promote LSP TY | 🟢 High | 🟡 Medium |
| 10 | Promote Workspaces | 🟢 High | 🟢 High |
| 11 | Promote Markdown | ⚪ None | 🟢 High |
| 12 | Rename Alpha Models | 🔴 Low | 🟡 Medium |

**Highest-value items** (high in both dimensions): **Workspaces (#10)** is the clear standout — it's foundational for multi-tenant backend architecture *and* a major UX improvement.

**High backend, low UX risk**: Master flag removal (#1), Output Token Max (#7), and LSP TY promotion (#9) are backend-critical but user-invisible.

**High UX, low backend risk**: Markdown (#11) is already default-on — promoting it is pure cleanup with zero risk.
