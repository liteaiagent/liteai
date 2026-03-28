# Comprehensive App Bundle Optimization & Refactoring Plan

Based on the Vite build analysis containing chunks exceeding 500kB and massive asset files, this document provides a comprehensive, step-by-step refactoring strategy mapped to specific files and technical causes. 

## 1. Initial Javascript Chunk (`dist/assets/index-*.js`)
**Current Size:** 2.95 MB (~838 kB gzip)  
**The Problem:** The root entry point of the app has snowballed into a massive monolith. Although route-level components like `Session` and `Home` are lazy-loaded, `src/app.tsx` and `src/pages/layout.tsx` statically import heavy layout wrappers, global context providers, and complex modal dialogue components. Because `Layout` wraps every page, any statically imported component inside it becomes part of the initial browser payload for the entire app.

### Refactoring Actions:
**A. Lazy-Load Dialog Modals in `src/pages/layout.tsx`**
The UI contains numerous dialog screens that are only rendered upon explicit user interaction (e.g., clicking "Settings" or "Edit Project"), but are statically imported at the top of the file:
```tsx
import { DialogEditProject } from "@/components/dialog-edit-project"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { DialogSettings } from "@/components/dialog-settings"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogDeleteWorkspace, DialogResetWorkspace } from "./layout/workspace-dialogs"
```
**The Fix:** Wrap every conditional modal in SolidJS's `lazy()`. Since these components use named exports, the wrapper must manually resolve the `default` export to satisfy Solid:
```tsx
import { lazy } from "solid-js";

const DialogSettings = lazy(async () => {
  const mod = await import("@/components/dialog-settings");
  // Wrap named export into default
  return { default: mod.DialogSettings }; 
});
```
*Note: `DialogSettings` is particularly heavy as it likely imports massive forms, config parsers, and editor previews.*

**B. Lazy-Load Route Wrappers in `src/app.tsx`**
```tsx
import DirectoryLayout from "@/pages/directory-layout"
import { ErrorPage } from "./pages/error"
```
- **`DirectoryLayout`:** Statically wrapping `/:dir` forces the initial app payload to always include SDK configuration logic (`SDKProvider`, `DirectoryDataProvider`, `LocalProvider`), even if a user just visits the home page `/` with no active directory. Convert this to:
  ```tsx
  const DirectoryLayout = lazy(() => import("@/pages/directory-layout"));
  ```
- **`ErrorPage`:** The error UI should only download if an ErrorBoundary catches something. Lazy load it.

---

## 2. Global Context Provider Scoping (`src/app.tsx`)
**The Problem:** The `AppShellProviders` function globally wraps the entire layout tree in contexts that might only be needed inside the `/session` route. 
```tsx
function AppShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <ModelsProvider>
               <CommandProvider>
                 <HighlightsProvider>...
```
- **`ModelsProvider` & `HighlightsProvider`:** If these contexts import external parsers, large data structures, or code-highlighting logic that is strictly useful inside the editor or chat (the `Session` route), they must be moved downstream into the `SessionProviders` component. Globally mounting them ensures their dependencies are permanently stapled to the `index` chunk.

**The Fix:** Audit `AppShellProviders`. Move context boundaries strictly to the lowest relevant tree node. If `HighlightsProvider` is only for code block syntax highlighting, it belongs nested inside `<SessionRoute>`.

---

## 3. Managing Massive Third-Party Syntax & Terminal Modules
**Current Sizes:**
- `cpp-*.js` (626 kB)
- `emacs-lisp-*.js` (779 kB)
- `wasm-*.js` (622 kB)
- `ghostty-web-*.js` (638 kB)
- `session-*.js` (553 kB)

**The Problem:** It is correct that these are code-split (they are not in the main `index`), but they are excessively large. `ghostty-web` (terminal) and language syntaxes (likely Shiki or Monaco grammars) are very heavy.
**The Fix:**
1. **Language Syntaxes:** Ensure that your markdown renderer's language configuration strictly uses dynamic imports for grammar injection (`shiki.loadLanguage()`). Do not statically map or preload arrays of `['cpp', 'emacs-lisp', 'wasm']`. 
2. **Ghostty Web:** Ensure the underlying terminal canvas/WASM is only mounted inside the lazily loaded `Session` route, preventing the 638kB chunk from fetching on the home screen.
3. **Session Route Optimization:** The `dist/assets/session-*.js` chunk (553 kB) is still too large. Run Vite's rollup visualizer (`rollup-plugin-visualizer`) on `packages/liteai-app` to identify which internal libraries in `Session` can be further split or removed.

---

## 4. Asset Deferral (`Fonts` & `SVGs`)
**Current Sizes:** 
- `Nerd Fonts (.woff2)`: Over 15MB total (1MB to 1.5MB per font family)
- `inter-*.woff2`: 349 kB
- `sprite-*.svg`: 955 kB

**The Problem:** The sheer size of assets being pushed into the output directory implies that CSS is fetching or globally mapping massive files.
- **Nerd Fonts (`iosevka`, `MesloLGS`, `FiraCode`, etc.):** If you have CSS that defines `@font-face` for all these fonts unconditionally, the browser may eagerly download them or at minimum massively bloat the static CSS file limits.
  **The Fix:** Do not statically import these font files or global CSS rules for them. Store the font definitions as metadata. When a user changes their `Settings -> Editor -> Font Family`, dynamically inject a `<style>` tag containing that specific `@font-face` URL into the `<head>`, so the user only ever downloads the ~1MB font they are actively using.
- **Inter Font:** 349kB is extremely large for an app UI font. 
  **The Fix:** Use a web subset of Inter (e.g. `latin-only`), which brings the size down to ~20-30kB, or rely on system fonts standardizing on `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto...`.
- **SVG Sprite Sheet:** 955kB of SVGs bundled into one continuous file.
  **The Fix:** This means literally every icon in the system is being downloaded. Standardize on dynamic icon definitions. Migrate away from massive SVG sprite-maps toward explicitly imported SVGs (`import Icon from "./icon.svg"`) so Vite can tree-shake unused icons, or use libraries like `lucide-solid` that natively support modular splitting.

---

## 5. Vite Config Splitting (`vite.config.ts` / `vite.js`)
**The Problem:** Rollup is struggling to natively split standard dependencies.
**The Fix:** Introduce explicit `manualChunks` in your `vite.js` Rollup config to organize the split cleanly. Group framework code separately from application code:

```javascript
build: {
  rollupOptions: {
    output: {
      manualChunks(id) {
        // Group SolidJS ecosystem
        if (id.includes("node_modules/solid-js")) return "vendor-solid";
        
        // Group Heavy markdown/shiki logic
        if (id.includes("node_modules/shiki") || id.includes("marked")) {
          return "vendor-markdown";
        }
        
        // Group Terminal logic
        if (id.includes("node_modules/ghostty")) return "vendor-terminal";
      }
    }
  }
}
```
