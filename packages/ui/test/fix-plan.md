# Fix Plan: Align UI (Storybook) with Web Chat Pane

> **Goal**: Make the Chat Pane in Storybook (`:6006`) render pixel-identical to the Web app (`:3000`).

---

## Root Cause Summary

The visual differences stem from **3 missing layers of context** that the Web app provides but Storybook does not:

| Layer | Web App | Storybook | Impact |
|:---|:---|:---|:---|
| **Body baseline** | `<body class="text-12-regular">` → 13px / 150% line-height | Browser default 16px / normal | All inherited text 3px larger, spacing ~4.5px taller |
| **Background token** | Chat panel uses `bg-background-stronger` (#fcfcfc / #151515) | Preview wrapper uses `--background-base` (#f8f8f8 / #101010) | Input box contrast washed out |
| **Container context** | Parent div has `@container` class | No container context (`normal`) | Container queries don't trigger; responsive breakpoints fail |

---

## Files to Modify

### 1. Storybook Preview Decorator
**File**: [preview.tsx](~/Documents/workspace/liteai/packages/storybook/.storybook/preview.tsx)

### 2. Chat Pane Story Wrapper
**File**: [story-wrapper.tsx](~/Documents/workspace/liteai/packages/ui/src/panes/chat/__mocks__/story-wrapper.tsx)

### 3. Chat Pane Story Definition *(optional)*
**File**: [chat-pane.stories.tsx](~/Documents/workspace/liteai/packages/ui/src/panes/chat/chat-pane.stories.tsx)

---

## Fix 1: Apply Root Font Baseline in Storybook Preview

**Target**: [preview.tsx#L57-L66](~/Documents/workspace/liteai/packages/storybook/.storybook/preview.tsx#L57-L66)

**Problem**: The preview decorator wrapper `<div>` applies inline styles with `padding: 24px` and `background-color: var(--background-base)` but **does not** set the root font-size/line-height baseline that the Web app sets on `<body>`.

**What the Web app does** ([index.html#L18](~/Documents/workspace/liteai/packages/web/index.html#L18)):
```html
<body class="antialiased overscroll-none text-12-regular overflow-hidden">
```

The `text-12-regular` class ([utilities.css#L46-L53](~/Documents/workspace/liteai/packages/ui/src/styles/utilities.css#L46-L53)) sets:
- `font-family: var(--font-family-sans)` → Inter
- `font-size: var(--font-size-small)` → **13px**
- `line-height: var(--line-height-large)` → **150%** (19.5px)
- `font-weight: var(--font-weight-regular)` → 400

**Fix**: Add `text-12-regular` and `antialiased` classes to the preview wrapper div. Remove the hardcoded `24px` padding (not present in web).

```diff
 <div
-  style={{
-    "min-height": "100vh",
-    padding: "24px",
-    "background-color": "var(--background-base)",
-    color: "var(--text-base)",
-  }}
+  class="text-12-regular antialiased"
+  style={{
+    "min-height": "100vh",
+    "background-color": "var(--background-base)",
+    color: "var(--text-base)",
+  }}
 >
```

> [!IMPORTANT]
> The `text-12-regular` class is defined in `packages/ui/src/styles/utilities.css`, which is loaded via the `@liteai/ui/styles/tailwind` import at the top of preview.tsx. No additional imports needed.

---

## Fix 2: Add Container Context and Correct Background in StoryWrapper

**Target**: [story-wrapper.tsx#L27](~/Documents/workspace/liteai/packages/ui/src/panes/chat/__mocks__/story-wrapper.tsx#L27)

**Problem**: The story wrapper renders the Chat Pane inside a plain `div` with `bg-background-base`, missing the `@container` class and the correct `bg-background-stronger` background.

**What the Web app does** ([session.tsx#L1080-L1089](~/Documents/workspace/liteai/packages/web/src/pages/session.tsx#L1080-L1089)):
```tsx
<div classList={{
  "@container relative shrink-0 flex flex-col min-h-0 h-full bg-background-stronger flex-1 md:flex-none": true,
  // ... transition classes
}}>
```

And the root layout ([index.html#L20](~/Documents/workspace/liteai/packages/web/index.html#L20)):
```html
<div id="root" class="flex flex-col h-dvh p-px"></div>
```

**Fix**: Update the wrapper div to include `@container` and use `bg-background-stronger`:

```diff
-<div class="h-[600px] w-[500px] bg-background-base overflow-hidden border border-border-weak relative flex flex-col">
+<div class="@container h-[600px] w-[500px] bg-background-stronger overflow-hidden border border-border-weak relative flex flex-col">
```

> [!NOTE]
> The `@container` class creates a CSS containment context that enables `@container` queries inside child components. Without it, any responsive breakpoints using `@container` modifiers (like elements collapsing at certain widths) will never trigger.

---

## Fix 3: Remove Preview Padding for Chat Pane Stories *(optional)*

**Target**: [chat-pane.stories.tsx](~/Documents/workspace/liteai/packages/ui/src/panes/chat/chat-pane.stories.tsx)

**Problem**: Even after Fix 1 removes the default `24px` padding, the wrapper div still has `min-height: 100vh` which may not match the web layout. For full-page pane stories, the preview padding should be zero.

**Fix**: Add story-level `parameters` to strip padding for chat pane stories:

```diff
 const meta = {
   title: "Panes/Chat/ChatPane",
   component: ChatPane,
+  parameters: {
+    layout: "fullscreen",
+  },
   decorators: [
```

> [!TIP]
> Storybook's `layout: "fullscreen"` removes the default padding/margin from the preview iframe body, making the story fill the available space — matching the web app's full-height behavior.

---

## Verification Checklist

After applying all fixes, verify in Storybook:

- [ ] **Font size**: Root container computes to `13px` (not `16px`) — inspect with DevTools
- [ ] **Line height**: Root container computes to `19.5px` (150% of 13px) — not `24px`
- [ ] **Background**: Chat pane background is `#fcfcfc` (light) / `#151515` (dark) — not pure white
- [ ] **Font rendering**: `antialiased` (subpixel-antialiased) matches web smoothing
- [ ] **Container queries**: Any `@container` responsive breakpoints now trigger at correct widths
- [ ] **New Session view**: "Build anything" title, path, branch, timestamp match web typography
- [ ] **Prompt input**: Placeholder text, model selector, agent selector spacing matches web
- [ ] **No regressions**: Other Storybook stories (non-chat) still render correctly with the new `text-12-regular` baseline

---

## Risk Assessment

| Fix | Risk | Mitigation |
|:---|:---|:---|
| **Fix 1** (preview baseline) | Affects all stories globally | All stories should inherit from this baseline since the web app does too; components use explicit utility classes (`text-14-regular`, etc.) that override the base |
| **Fix 2** (container + bg) | Scoped to ChatPane stories only | Only touches the story mock wrapper |
| **Fix 3** (fullscreen layout) | Scoped to ChatPane story meta | Only affects this story's Storybook chrome |
