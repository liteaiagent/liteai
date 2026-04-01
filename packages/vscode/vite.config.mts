import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"

export default defineConfig({
  plugins: [tailwindcss(), solidPlugin()],
  // Set base to match the webview resource URL structure.
  // VS Code maps vscode-webview://ID/<path> → {extensionUri}/<path>.
  // Our files live at dist/webview/assets/*, so requests must start with
  // /dist/webview/ to resolve to the right location on disk.
  // (The script and style tags in chat-view-provider are overridden via
  //  webview.asWebviewUri(), so the base doesn't affect them.)
  base: "/dist/webview/",
  build: {
    outDir: path.resolve(__dirname, "dist", "webview"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "src/webview/index.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "src"),
      "@": path.resolve(__dirname, "src"),
    },
  },
})
