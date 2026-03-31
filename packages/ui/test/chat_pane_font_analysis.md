# Chat Pane — Font Family & Visual Analysis

A code + visual inspection of the Chat Pane component across both environments (Web App `:3000` and Storybook `:6006`).

---

## 1. Font Families Overview

The Chat Pane uses **exactly two font families**, both self-hosted (bundled as `.woff2`), not loaded from Google Fonts CDN:

| Font Family | Type | Source | CSS Variable | Loaded From |
| :--- | :--- | :--- | :--- | :--- |
| **Inter** | Sans-serif (Variable) | [Google Fonts origin](https://fonts.google.com/specimen/Inter), bundled locally | `--font-family-sans` | `inter.woff2` (variable weight 100–900) |
| **IBM Plex Mono** | Monospace | [Google Fonts / IBM origin](https://fonts.google.com/specimen/IBM+Plex+Mono), bundled locally | `--font-family-mono` | `BlexMonoNerdFontMono-{Regular,Medium,Bold}.woff2` |

### Fallback Chains

| Variable | Resolved Value |
| :--- | :--- |
| `--font-family-sans` | `"Inter", "Inter Fallback"` |
| `--font-family-mono` | `"IBM Plex Mono", "IBM Plex Mono Fallback"` |

> [!NOTE]
> **"Inter Fallback"** is a synthetic `@font-face` mapping to `local("Arial")` with metric overrides (`size-adjust: 100%`, `ascent-override: 97%`).
> **"IBM Plex Mono Fallback"** maps to `local("Courier New")` with similar overrides.
> These aren't separate Google Fonts — they're CLS-prevention fallback declarations.

---

## 2. Chat Pane Elements — Font Mapping

### 2a. New Session View (`ChatNewSession`)

| Element | CSS Utility Class | Font Family | Size | Weight | Line Height |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **"Build anything"** title | `text-20-medium` | Inter (sans) | 20px | 500 | 180% (36px) |
| **Project path** (`C:/Users/...`) | `text-12-medium` | Inter (sans) | 13px | 500 | 150% (19.5px) |
| **Branch name** | `text-12-medium` | Inter (sans) | 13px | 500 | 150% (19.5px) |
| **"Last modified"** timestamp | `text-12-medium` | Inter (sans) | 13px | 500 | 150% (19.5px) |

### 2b. Prompt Input (`ChatPromptInput`)

| Element | CSS Utility Class | Font Family | Size | Weight | Line Height |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Editor text** (user typing) | `text-14-regular` | Inter (sans) | 14px | 400 | 180% (25.2px) |
| **Placeholder** ("Ask anything...") | `text-14-regular` | Inter (sans) | 14px | 400 | 180% (25.2px) |
| **Model name** button ("GPT-4") | `text-13-regular` | Inter (sans) | 13px | 400 | 150% |
| **Agent selector** | `text-13-regular` | Inter (sans) | 13px | 400 | 150% |
| **Context items** (file pills) | `text-11-regular` | Inter (sans) | 11px | 500 | — |

### 2c. Message Timeline (when messages are present)

| Element | CSS Utility Class | Font Family | Size | Weight |
| :--- | :--- | :--- | :--- | :--- |
| **User message text** | `text-14-regular` | Inter (sans) | 14px | 400 |
| **Code blocks** (in assistant markdown) | base.css `code, pre` | IBM Plex Mono | 1em (14px) | 400 |
| **Inline code** (in assistant markdown) | base.css `code` | IBM Plex Mono | 1em | 400 |
| **Diff viewer** body | pierre config | IBM Plex Mono | — | — |
| **Diff viewer** headers | pierre config | Inter (sans) | — | — |

---

## 3. Font Feature Settings

Both fonts use OpenType feature flags for refined rendering:

| Font | Feature | Value | Effect |
| :--- | :--- | :--- | :--- |
| Inter | `ss03` | 1 | Alternate curved `r` and rounded punctuation |
| IBM Plex Mono | `ss01` | 1 | Alternate glyph forms (e.g., slashed zero) |

---

## 4. User-Configurable Mono Font

The mono font (`--font-family-mono`) can be changed by the user in Settings → Appearance. The default is `ibm-plex-mono`. Available options (all bundled as Nerd Font variants):

| Setting Key | Font Family | Bundled File |
| :--- | :--- | :--- |
| `ibm-plex-mono` *(default)* | IBM Plex Mono | `BlexMonoNerdFontMono-*.woff2` |
| `jetbrains-mono` | JetBrains Mono Nerd Font | `JetBrainsMonoNerdFontMono-*.woff2` |
| `fira-code` | Fira Code Nerd Font | `FiraCodeNerdFontMono-*.woff2` |
| `cascadia-code` | Cascadia Code Nerd Font | `CaskaydiaCoveNerdFontMono-*.woff2` |
| `hack` | Hack Nerd Font | `HackNerdFontMono-*.woff2` |
| `source-code-pro` | Source Code Pro Nerd Font | `SauceCodeProNerdFontMono-*.woff2` |
| `inconsolata` | Inconsolata Nerd Font | `InconsolataNerdFontMono-*.woff2` |
| `roboto-mono` | Roboto Mono Nerd Font | `RobotoMonoNerdFontMono-*.woff2` |
| `ubuntu-mono` | Ubuntu Mono Nerd Font | `UbuntuMonoNerdFontMono-*.woff2` |
| `intel-one-mono` | Intel One Mono Nerd Font | `IntoneMonoNerdFontMono-*.woff2` |
| `meslo-lgs` | Meslo LGS Nerd Font | `MesloLGSNerdFontMono-*.woff2` |
| `iosevka` | Iosevka Nerd Font | `iosevka-nerd-font*.woff2` |
| `geist-mono` | GeistMono Nerd Font | `GeistMonoNerdFontMono-*.woff2` |

All mono options fall back through `IBM Plex Mono` → system monospace stack.

---

## 5. Storybook vs Web App — Visual Differences (Chat Pane)

| Aspect | Web App (`:3000`) | Storybook (`:6006`) | Delta |
| :--- | :--- | :--- | :--- |
| **Sans font** | Inter ✅ | Inter ✅ | Match |
| **Mono font** | IBM Plex Mono ✅ | IBM Plex Mono ✅ | Match |
| **Root font-size** | **13px** (app body class) | **16px** (browser default) | ⚠ Storybook 3px larger |
| **Root line-height** | **19.5px** | **24px** | ⚠ Storybook ~4.5px taller |
| **Explicit element font-size** | 14px | 14px | Match (overridden by utility classes) |
| **Background** | `#fcfcfc` (background-stronger) | `#ffffff` (pure white) | ⚠ Contrast difference |
| **Container query context** | `@container` parent | `normal` (no container context) | ⚠ Responsive breakpoints don't trigger |
| **Storybook wrapper font** | N/A | `Nunito Sans` (Storybook UI chrome only) | N/A — doesn't affect component |

> [!IMPORTANT]
> The Chat Pane component itself uses **only Inter and IBM Plex Mono**. The `Nunito Sans` seen in Storybook is Storybook's own sidebar/chrome UI — it does **not** bleed into the component preview iframe.

---

## 6. Font Loading Architecture

Fonts are loaded via the `<Font />` component ([font.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/components/font.tsx)):

```
<Font /> component
  ├── @font-face "Inter" (variable weight, woff2-variations)
  ├── @font-face "Inter Fallback" → local("Arial") + metric overrides
  ├── @font-face "IBM Plex Mono" (400, 500, 700 weights)
  ├── @font-face "IBM Plex Mono Fallback" → local("Courier New") + metric overrides
  └── 12 × Nerd Font Mono variants (loaded but not active unless user selects them)
```

The theme CSS ([theme.css](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/styles/theme.css#L1-L5)) sets the CSS variables, and `base.css` applies them to `html, :host` and `code, kbd, samp, pre` elements respectively.

---

## Summary

| Category | Font | Origin | Status |
| :--- | :--- | :--- | :--- |
| **All UI text** (Chat Pane) | **Inter** | Google Fonts (self-hosted woff2) | ✅ Active in both environments |
| **Code/mono text** (code blocks, diffs) | **IBM Plex Mono** | IBM/Google Fonts (self-hosted woff2, Nerd Font variant) | ✅ Active, user-configurable |
| **Storybook chrome only** | Nunito Sans | Storybook default | ⚠ Storybook UI only, not in components |
| **System fallbacks** | Arial, Courier New | OS built-in | Used only while web fonts load |
