# 06 — Slot Architecture

## The 4-Slot Layout

LiteAI's `SessionLayout` has 4 rendering slots. Understanding WHICH slot a component should render in is critical for both correctness and future extensibility.

```
┌─────────────────────────────────────────────┐
│                                             │
│              SCROLLABLE SLOT                │ ← Messages, tool output, spinner
│              (inside ScrollBox)             │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │         OVERLAY SLOT                │    │ ← Permission prompts, questions
│  │         (inside ScrollBox, after    │    │   (system-initiated, during stream)
│  │          messages)                  │    │
│  └─────────────────────────────────────┘    │
│                                             │
├─────────────────────────────────────────────┤
│              BOTTOM SLOT                    │ ← Prompt input, status line,
│              (flexShrink=0, below scroll)   │   token warning
│                                             │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│              MODAL SLOT (current)           │ ← Slash command dialogs
│              (absolute, bottom=0, opaque)   │   (user-initiated)
│                                             │
└─────────────────────────────────────────────┘
```

---

## Slot Assignment Rules

| Trigger | Slot | Reason |
|---------|------|--------|
| User types `/model` | **MODAL** → becomes **BOTTOM** (after Alternative A) | User-initiated, replaces prompt |
| AI asks a question | **OVERLAY** | System-initiated, user needs transcript context |
| AI requests permission | **OVERLAY** | System-initiated, user needs to see the command |
| Spinner / streaming | **SCROLLABLE** (bottom of scroll) | Auto-scrolls with content |
| Toast notification | **BOTTOM** (absolute, above prompt) | Transient, doesn't affect layout |
| Session browser (future) | **MODAL** → **BOTTOM** | User-initiated, full screen |
| Plan/Todo view (future) | **BOTTOM** (inline, above prompt) | Persistent, user needs to reference while typing |

---

## Alternative A: Move Modal Into Bottom

The proposed change moves modal content from absolute positioning into the bottom slot:

### Before (Current)

```
┌─────────────────────────┐
│     Scrollable          │  ← Still visible (2-row peek)
│     Messages...         │
├─────────────────────────┤
│     Bottom (Prompt)     │  ← STILL MOUNTED, accepting input ← BUG
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  │
│  Modal (Settings)       │  ← absolute, opaque, overlaps bottom
│                         │
└─────────────────────────┘
```

### After (Alternative A)

```
┌─────────────────────────┐
│     Scrollable          │  ← Full area (no peek limitation)
│     Messages...         │
├─────────────────────────┤
│     Bottom:             │
│     {modal ?? prompt}   │  ← SWAP: only one is mounted at a time
│                         │
│     StatusLine          │
└─────────────────────────┘
```

### Impact on Future Screens

Full-screen screens (session browser, plan editor) set `flexGrow={1}` on their container:

```
┌─────────────────────────┐
│  Scrollable (collapsed) │  ← Shrinks to 0 or minimal
├─────────────────────────┤
│     Bottom:             │
│     ┌─────────────────┐ │
│     │ Session Browser  │ │  ← flexGrow={1}, fills available space
│     │ ① Session "fix"  │ │
│     │ ② Session "feat" │ │
│     │   ...            │ │
│     └─────────────────┘ │
│     StatusLine          │
└─────────────────────────┘
```

The Scrollable area naturally shrinks because the Bottom slot's content grows. This is standard CSS flexbox behavior.

---

## Overlay Slot (Unchanged)

HITL (permissions, questions) continues to use the `overlay` slot inside the ScrollBox:

```
┌─────────────────────────┐
│     Messages...         │
│     > Running: rm -rf / │
│                         │
│  ┌─────────────────────┐│
│  │ △ Permission needed ││  ← overlay: inside ScrollBox, after messages
│  │ Allow once?         ││
│  │ [Allow] [Reject]    ││
│  └─────────────────────┘│
├─────────────────────────┤
│  ❯ _                   │  ← prompt: still mounted, but isFocused=false
│  tokens: 1.2k          │
└─────────────────────────┘
```

This is correct. The user needs to see the transcript context (what command is requesting permission) while making their decision. The prompt stays mounted but yields focus via `isFocused` gating.

---

## Toast Slot (Unchanged)

Already implemented correctly:

```tsx
<Box position="absolute" bottom="100%" left={0} right={0} opaque>
  <Toast />
</Box>
```

Floats above the bottom bar. Doesn't interact with any other slot.
