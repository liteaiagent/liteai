# CreateEffect Simplification — Risk Assessment

Companion to `create-effect-simplification-spec.md`.

---

## Risk Rating Key

| Rating | Meaning |
|--------|---------|
| 🟢 Low | Mechanical change; regression is immediately visible and easy to revert |
| 🟡 Medium | Requires understanding state ownership; edge cases may not surface immediately |
| 🔴 High | Touches initialization order, persistence, or multi-concern interactions; wrong moves cause silent failures |

---

## Per-Item Risk

### Item 1 — Normalize Tab State (`session.tsx:141`) 🟢

**Risk**: Low.

Tabs should be normalized at the write boundary. Moving normalization earlier is mechanical. The only failure mode is that a write path is missed and tabs arrive in denormalized form — which is immediately visible in the UI.

**Guard**: Verify all call sites that create or restore tab state produce normalized output.

---

### Item 2 — Key Session-Owned State (`session.tsx:325/336/477/869/963`, `message-timeline.tsx:149`) 🟡

**Risk**: Medium.

The risk is drawing the keyed boundary too broadly and accidentally resetting state that should survive a session switch — for example editor drafts, scroll position, or focus.

**Guard**: Before keying, explicitly list every signal and store value in scope and classify each as session-local or app-global. Only move session-local state inside the keyed boundary. Verify back-navigation and rapid session switching manually.

---

### Item 3 — Derive Workspace Order (`layout.tsx:557`) 🔴

**Risk**: High.

Workspace ordering involves three interacting concerns: live workspace data from the backend, persisted user overrides, and the computed effective display order. An effect currently keeps them in sync. Replacing it with a memo requires understanding which of the three is authoritative in each scenario.

**Failure modes**:
- User reorder is lost on reload if the override is not persisted correctly
- A workspace that disappears from live data is not handled by the memo
- Memo reads stale override data if the override store is populated later than the live data

**Guard**: Map the data lifecycle (initial load → user reorder → workspace added/removed → reload) before writing any code. Pin the memo's dependency set explicitly and test each lifecycle step.

---

### Item 4 — Remove Child-Store Mirrors (`global-sync.tsx:130/138/148`, `child-store.ts:184/190/193`, `layout.tsx:424`) 🔴

**Risk**: High. This is the highest-risk item in the spec.

Child-store hydration effects exist because ownership of global vs. child-store state is not obvious at the call site. Removing an effect before understanding the initialization order will produce broken state on first load, on navigation, or after child-store creation.

**Note**: `global-sync.tsx` already appears to have had its effects removed. Verify that first-load initialization, reload, and child-store creation paths still work correctly before touching anything else in this area.

**Failure modes**:
- Child store is created before global data is available → store initializes with empty/stale values
- Reload path no longer propagates because the reactive relay was the only trigger
- State appears correct on first load but breaks after a soft navigation

**Guard**: Trace the full ownership chain for each affected value before deleting any effect. Write the initialization path and the update path explicitly in comments before removing the effect that was doing both.

---

### Item 5 — Key File-Scoped State (`file.tsx:100`) 🟡

**Risk**: Medium. Lower blast radius than session keying.

File scope is a narrower identity boundary than session, so the surface area of accidental reset is smaller. The main risk is resetting state that should persist across scope changes within the same session.

**Guard**: Verify scope transitions do not drop in-flight edits or pending operations.

---

### Item 6 — Split Layout Side Effects (`layout.tsx:1489`, `:484`, `:652`, `:776`, `:1519`) 🟡

**Risk**: Medium-High.

The mixed-responsibility effect at `:1489` handles multiple unrelated concerns in one body. Splitting it into direct handlers is conceptually simple but any missed branch produces a silent failure — the user performs an action and nothing happens.

**Failure modes**:
- A branch is moved to a handler that is called in fewer cases than the original effect
- A branch is left in the effect and also added to a handler, causing double execution

**Guard**: List every branch in the effect and trace its trigger condition before moving anything. Verify each user-facing action that previously depended on this effect still fires exactly once.

---

### Item 7 — Remove Duplicate Triggers (`review-tab.tsx`, `file-tabs.tsx`, `use-session-hash-scroll.ts`) 🟢

**Risk**: Low.

Collapsing three identical effect bodies into one shared function is a mechanical refactor. The only risk is introducing an off-by-one in when the function is called vs. when the original effects fired.

**Guard**: Confirm the timing of the shared function call matches the timing of each original effect trigger.

---

### Item 8 — Make Prompt Filtering Reactive (`prompt-input.tsx:652`) 🟢

**Risk**: Low.

Slash-command filtering is pure derived state from the current input and candidate list. Converting it to a memo is mechanically safe. The editor sync effect at `:690` must remain untouched.

**Guard**: Verify filtering updates on every keystroke and that the editor sync effect still fires at the right time.

---

### Item 9 — Clean Up Smaller Derived-State Cases (`terminal.tsx:261`, `session-header.tsx:309`) 🟢

**Risk**: Low.

These are straightforward memo conversions. They have no side effects and no initialization-order dependency.

---

## Cross-Cutting Risks

### Doing Multiple Phases Simultaneously

The highest practical risk is running several phases in parallel and being unable to isolate which change caused a regression. If session keying, child-store removal, and layout splitting land in the same commit, debugging is significantly harder.

**Mitigation**: One phase per PR. Verify the app is behaviorally stable before starting the next phase.

### Timing Differences Between Effects and Memos

SolidJS effects run after rendering; memos run synchronously during the reactive computation. In most cases this is fine, but any code that relied on an effect running after a paint may behave differently when replaced with a memo.

**Mitigation**: For any memo that replaces an effect in a render-critical path, verify first-render output matches.

### Cleanup Gaps

Removing an effect that had an `onCleanup` callback will silently drop that cleanup. This is most dangerous for scroll handlers, event listeners, and timers.

**Mitigation**: Before deleting any effect, check its body and any `onCleanup` registered inside it. Move the cleanup to `onCleanup` in the nearest owner if it is still needed.

---

## Recommended Phase Order (Lowest to Highest Risk)

1. Item 8 — Prompt filtering memo
2. Item 9 — Terminal and session-header memos
3. Item 7 — Duplicate trigger collapse
4. Item 1 — Tab normalization at write boundary
5. Item 5 — File scope keying
6. Item 2 — Session scope keying
7. Item 6 — Layout side-effect split
8. Item 3 — Workspace order derivation
9. Item 4 — Child-store mirror removal (last, after auditing ownership)

---

## Definition Of Safe To Ship Per Phase

A phase is safe to ship when:

- The targeted effects are deleted (not just commented out)
- Manual verification covers the flows listed in the spec's verification section
- No `onCleanup` callback was silently dropped
- No action that previously fired once now fires twice or not at all
- TypeScript reports no new errors
