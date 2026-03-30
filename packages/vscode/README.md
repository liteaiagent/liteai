# liteai VS Code Extension

A Visual Studio Code extension that integrates liteai directly into your development workflow.

## Development

The LiteAI VS Code Extension consists of two main parts:
1. **Extension Host**: Runs the VS Code API logic, manages the ServerManager, and handles IPC.
2. **Webview UI**: A SolidJS application built with Vite that renders the Chat interface.

### Prerequisites
Before starting the extension development server, ensure you have built the local `liteai-core` executable, as the extension will attempt to spawn it.

```bash
# From the repository root
bun install
```

### Running in Dev Mode

1. Open the workspace (`liteai.code-workspace`) or the `packages/vscode` directory in VS Code.
2. Press **`F5`** to launch the Extension Development Host window. This will automatically run `--watch` builds for both the webview and the extension host in the background.

> **Tip**: If you make changes to the Webview UI, right-click inside the Webview in the debug window and select **Reload Webview** to see changes without restarting the extension host. For Extension Host changes, use `Cmd+Shift+P` -> **Developer: Reload Window**.

## Building for Production

To compile everything and build the final `.vsix` package:

1. Ensure the core executable can be built on your machine:
   ```bash
   cd packages/vscode
   ```
2. Run the automated build script which handles the complete production lifecycle:
   - Builds the `liteai-core` exes
   - Copies the exes into `packages/vscode/bin/`
   - Compiles the webview to `dist/webview/`
   - Typechecks and Lints
   - Builds the extension host to `dist/extension.js`
   - Generates the VSIX package using `vsce`

   ```bash
   bun run package
   ```
