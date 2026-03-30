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

The extension supports three server connection modes:

#### 1. Dev Mode (recommended for development)

Connect to a separately running `liteai-core` dev server. This is the fastest workflow for iterating on both the extension and the core server.

**Step 1**: Start the core dev server in a separate terminal:
```bash
cd packages/core
bun dev
# Server starts on http://127.0.0.1:9000
```

**Step 2**: Open the `packages/vscode` directory in VS Code and press **`F5`** to launch the Extension Development Host. The `launch.json` is pre-configured with `LITEAI_DEV_SERVER_URL=http://127.0.0.1:9000`.

The extension will connect to the external dev server instead of spawning its own binary.

#### 2. Remote Mode

Set the `liteai.server.url` VS Code setting to connect to a remote server:

```json
{
  "liteai.server.url": "http://your-server:9000"
}
```

#### 3. Production Mode (default)

If no dev URL or remote URL is configured, the extension spawns the bundled `liteai-core` binary from `bin/<platform>-<arch>/`.

### F5 Development Workflow

1. Open the workspace (`liteai.code-workspace`) or the `packages/vscode` directory in VS Code.
2. Start the core server: `cd packages/core && bun dev`
3. Press **`F5`** to launch the Extension Development Host window. This will automatically run `--watch` builds for both the webview and the extension host in the background.

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
