# Experimental Features

LiteAI includes several experimental features that are currently in development or testing phases. These features may be unstable, subject to change, or removed in future versions. You can opt-in to these features by setting specific environment variables before running LiteAI.

## How to Enable Experimental Features

All feature flags are configured via environment variables. By convention, they use the `LITEAI_` prefix.

Boolean flags can be enabled by setting their value to `"true"` or `"1"`. They can be disabled by setting them to `"false"` or `"0"`.

### The Global Experimental Flag

You can enable sweeping experimental changes by setting the global master flag:

```bash
export LITEAI_EXPERIMENTAL=1
```

When `LITEAI_EXPERIMENTAL` is truthy, the following experimental features are automatically enabled:
- **Icon Discovery** (`LITEAI_EXPERIMENTAL_ICON_DISCOVERY`): Automatically sets appropriate icons for your active projects based on project contents. **How it works:** When a project is registered, it scans the repository for `favicon.{ico,png,svg,jpg,jpeg,webp}` files. It picks the file closest to the root, reads it into a Base64 string, and saves it as a Data URI in the project's database record to represent the project in the UI.
- **Oxfmt Formatter** (`LITEAI_EXPERIMENTAL_OXFMT`): Uses `oxfmt` (OxC formatter) instead of standard formatters (like Prettier) for code formatting. **How it works:** The formatting engine skips the standard Prettier pass and instead sends the code to the highly optimized, Rust-based OxC `oxfmt` binary for lightning-fast formatting string-replacements.
- **Plan Mode** (`LITEAI_EXPERIMENTAL_PLAN_MODE`): Adds a `PlanExitTool` to the CLI, allowing the AI to construct an execution plan before exiting. **How it works:** If the client is the CLI, it injects a tool that the AI can call to format and store an execution plan state, enforcing a separation between the planning and execution phases.
- **Workspaces Routing** (`LITEAI_EXPERIMENTAL_WORKSPACES`): Enables multi-workspace request routing over the control plane, handling multiple separate projects concurrently from a single LiteAI instance. **How it works:** A middleware intercepts API requests on the control plane, extracts project or workspace IDs, and delegates the state and context to the corresponding isolated sandbox rather than a single monolithic instance.

---

## Specific Feature Flags

If you do not want to enable all experimental features at once, you can individually toggle specific functionalities using their respective environment variables.

### 1. File Watcher Implementations
- **`LITEAI_EXPERIMENTAL_FILEWATCHER`**: Enables an experimental, alternative implementation of the file watcher. **Advantage:** Unlike the default behavior, which only monitors your `.git/HEAD` file to detect branch checkouts, this flag enables `@parcel/watcher` to recursively monitor your **entire project workspace** using high-performance native OS handlers (like `inotify` or `fs-events`). This allows the system to instantly sync external file additions, deletions, or edits in real-time without needing a manual refresh.
- **`LITEAI_EXPERIMENTAL_DISABLE_FILEWATCHER`**: Completely disables file watching capabilities. LiteAI will not automatically detect changes made to files on disk.

### 2. UI and Editor Behavior
- **`LITEAI_EXPERIMENTAL_ICON_DISCOVERY`**: Automatically discovers and sets appropriate icons for your active projects based on project contents. (Enabled by `LITEAI_EXPERIMENTAL`)
- **`LITEAI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT`**: Prevents text from being automatically copied to the clipboard when highlighted/selected in the terminal. *Note: This behavior is enabled by default on Windows.*

### 3. Tooling and Integrations
- **`LITEAI_EXPERIMENTAL_OXFMT`**: Uses `oxfmt` (OxC formatter) for code formatting operations instead of standard formatters like Prettier. (Enabled by `LITEAI_EXPERIMENTAL`)
- **`LITEAI_EXPERIMENTAL_LSP_TY`**: Enables the `ty` (Typos) Language Server and disables other specific language servers (like `pyright`) to run typo/spellchecking against your repository.
- **`LITEAI_EXPERIMENTAL_MARKDOWN`**: Controls markdown rendering and parsing. This feature is enabled by default unless explicitly disabled by setting it to `false` or `0`.

### 4. Advanced Limits and Run Configurations
- **`LITEAI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`**: Overrides the default execution timeout for terminal commands run by the AI agent. The default is `120000` (2 minutes). 
  - *Usage Example:* `export LITEAI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS=300000` (5 minutes)
- **`LITEAI_EXPERIMENTAL_OUTPUT_TOKEN_MAX`**: Overrides the maximum output token limit allowed for provider responses. The default is `32000`.
  - *Usage Example:* `export LITEAI_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000`

### 5. Architectural Features
- **`LITEAI_EXPERIMENTAL_PLAN_MODE`**: Enables a planning mode in the CLI, equipping the AI agent with a `PlanExitTool` to structure out objectives before exiting. (Enabled by `LITEAI_EXPERIMENTAL`)
- **`LITEAI_EXPERIMENTAL_WORKSPACES`**: Enables multi-workspace request routing over the control plane, allowing a single LiteAI instance to manage multiple separate projects concurrently. (Enabled by `LITEAI_EXPERIMENTAL`)
