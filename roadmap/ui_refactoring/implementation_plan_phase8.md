# Phase 8 — Final Completion (93% → 100%): Implementation Plan

Implement the 6 remaining TUI features to bring the CLI from 93% to 100% feature coverage. All core APIs and SDK methods already exist — this is a pure CLI-layer effort requiring zero backend changes.

## Keybinding Strategy: Claude Code Alignment

After auditing Claude Code's `defaultBindings.ts` and `LogSelector.tsx`, we align our keybindings to match their patterns:

1. **`Select` context**: Stripped to minimal — nav keys (`up`/`down`/`j`/`k`/`ctrl+n`/`ctrl+p`) + `enter` (accept) + `escape` (cancel). All other session-list actions (`delete`, `rename`, `archive`, `tag`) move **out** of the `Select` keybinding context and into component-level `useInput` handlers — matching Claude Code's `LogSelector` which handles `Ctrl+A`/`Ctrl+B`/`Ctrl+R`/`Ctrl+V`/`Ctrl+W` via raw input, not via the centralized binding system.

2. **Session list shortcuts** (handled inline in `dialog-session-list.tsx`):
   - `Ctrl+A` → toggle archive view (Claude: "show all projects")
   - `Ctrl+R` → rename session (Claude: same)
   - `Ctrl+D` → delete session (Claude: exit — we repurpose for delete, consistent with our existing behavior)
   - `Ctrl+T` → tag session
   - `Tab` → cycle tag filter

3. **Transcript mode**: `Ctrl+E` → `transcript:toggleShowAll` (matches Claude Code exactly)
4. **Tab management**: `alt+1`–`alt+5` for direct access, `Ctrl+W` for close tab
5. **Rewind dialog**: `r` for direct revert, `f` for direct fork, `Enter` for action menu

> [!WARNING]
> **Terminal emulator `ctrl+tab` limitation (8.3)**: `ctrl+tab` is not capturable in many terminal emulators. We use `alt+1`–`alt+5` as the primary tab switching mechanism (universally supported).

## Open Questions

1. **8.3 — Tab persistence scope**: Should session tabs persist per-project or globally? The phase doc says "persisted to `tui.json`", which is project-scoped. Confirm this is correct — reopening the CLI in the same project should restore tabs.

2. **8.2/8.6 — Merged or separate implementation?**: The phase doc notes 8.2 (Branch) and 8.6 (Restore Options) overlap in the rewind dialog. I propose implementing them as a **single unified rewind action system** in one pass. The `dialog-rewind-actions.tsx` sub-dialog from 8.6 naturally absorbs the fork action from 8.2.

3. **8.4 — Compaction boundary detection**: The phase doc says "find the index of the last message containing a `compaction` part". Claude Code uses `summarizeMetadata` on user messages. Our SDK uses `compaction`-type parts on assistant messages. I'll follow our existing convention (`part.type === "compaction"`).

---

## Proposed Changes

Execution order follows the phase doc's recommendation: simplest first, with 8.2/8.6 merged.

---

### Component 1: Multi-File Patch Batch Summary (8.5)

*Complexity: Low (0.25 day). Pure rendering — add aggregate summary header to diff dialog.*

#### [MODIFY] [dialog-diff.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-diff.tsx)

**Before list view**, compute and render:
- Aggregate summary: `{N} files changed  +{totalAdditions}  -{totalDeletions}`
- File type breakdown: `"3 .ts · 1 .tsx · 1 .css"` in muted text
- Sort file list by status: Added (A) → Modified (M) → Deleted (D)

```tsx
// Computed from existing diffs array (already in state):
const totalAdditions = diffs.reduce((sum, d) => sum + d.additions, 0)
const totalDeletions = diffs.reduce((sum, d) => sum + d.deletions, 0)

// File type breakdown
const extCounts = new Map<string, number>()
for (const d of diffs) {
  const ext = d.file.includes('.') ? `.${d.file.split('.').pop()}` : 'other'
  extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)
}
const extSummary = [...extCounts.entries()].map(([ext, count]) => `${count} ${ext}`).join(' · ')

// Sorted diffs: A → M → D
const statusOrder = { added: 0, modified: 1, deleted: 2 }
const sortedDiffs = [...diffs].sort((a, b) => 
  (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1)
)
```

Render the summary header above the file list in the list view branch.

---

### Component 2: Show All — Post-Compaction History Toggle (8.4)

*Complexity: Low (0.5 day). State toggle + message filtering.*

#### [MODIFY] [ctx.tsx](file:///d:/liteai/packages/cli/src/tui/routes/session/ctx.tsx)

Add `showPreCompaction: boolean` to the `SessionContext` type.

#### [MODIFY] [index.tsx](file:///d:/liteai/packages/cli/src/tui/routes/session/index.tsx)

1. Add state: `const [showPreCompaction, setShowPreCompaction] = useState(false)`
2. Replace the no-op `transcript:toggleShowAll` handler:
   ```ts
   "transcript:toggleShowAll": () => setShowPreCompaction((v) => !v),
   ```
3. Pass `showPreCompaction` into `SessionProvider` value.

#### [MODIFY] [messages.tsx](file:///d:/liteai/packages/cli/src/tui/routes/session/messages.tsx)

In the `Messages` component, filter the messages array before rendering:

```ts
const ctx = useSessionContext()
const filteredMessages = useMemo(() => {
  if (ctx.showPreCompaction) return messages
  // Find the last compaction boundary
  let compactionIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = partsMap[messages[i].id] ?? []
    if (parts.some(p => p.type === "compaction")) {
      compactionIndex = i
      break
    }
  }
  if (compactionIndex === -1) return messages
  return messages.slice(compactionIndex)
}, [messages, partsMap, ctx.showPreCompaction])
```

Use `filteredMessages` instead of `messages` for `VirtualMessageList` rendering.

#### [MODIFY] [compact-summary.tsx](file:///d:/liteai/packages/cli/src/tui/components/compact-summary.tsx)

Accept `showPreCompaction` as a prop (or read from `useSessionContext`). Update hint text:
- When collapsed: `"(Press ctrl+e to show full history)"`
- When expanded: `"(Press ctrl+e to collapse)"`

---

### Component 3: Session Archive UI (8.1)

*Complexity: Low (0.5 day). Wiring existing infrastructure.*

#### [MODIFY] [dialog-session-list.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-session-list.tsx)

1. **Archive visual indicator**: In the options map, add `📦` gutter icon for archived sessions:
   ```ts
   const isArchived = !!x.time.archived
   // In gutter:
   gutter: isWorking ? <Spinner /> : isArchived ? <Text dim>📦</Text> : hasParent ? <Text color={theme.info}>⑂</Text> : undefined
   ```

2. **Dimmed styling for archived**: Add `dim={isArchived}` to the title text.

3. **Archived view toggle**: Add `showArchived` state. Toggle via `Ctrl+A` (inline `useInput` handler, matching Claude Code's `Ctrl+A` for "show all projects"):
   ```ts
   const [showArchived, setShowArchived] = useState(false)
   // Via useInput (not keybinding system — matches Claude Code LogSelector pattern):
   useInput((input, key) => {
     if (key.ctrl && input === 'a') setShowArchived(v => !v)
   })
   // In sessions filter:
   .filter(x => showArchived ? !!x.time.archived : !x.time.archived)
   ```

4. **Toast feedback**: After archive/unarchive action, show toast:
   ```ts
   toast.show({
     variant: "success",
     message: session.time.archived ? "Session restored from archive" : "Session archived",
   })
   ```

5. **Header indicator**: Show "📦 Archived" tab in header when `showArchived` is true.

6. **Migrate existing session-list shortcuts to inline handlers**: Move `Ctrl+D` (delete), `Ctrl+R` (rename), `Ctrl+T` (tag), `Tab` (filter cycle) from the `Select` keybinding context into component-level `useInput` handlers. This matches Claude Code's pattern where LogSelector handles all its shortcuts via raw input, not the centralized keybinding system.

#### [MODIFY] [default-bindings.ts](file:///d:/liteai/packages/cli/src/tui/keybindings/default-bindings.ts)

**Strip the `Select` context** down to minimal nav — matching Claude Code's pattern:
```ts
{
  context: "Select",
  bindings: {
    up: "select:previous",
    down: "select:next",
    j: "select:next",
    k: "select:previous",
    "ctrl+n": "select:next",
    "ctrl+p": "select:previous",
    enter: "select:accept",
    escape: "select:cancel",
  },
}
```

Remove: `pageup`, `pagedown`, `home`, `end`, `space`, `ctrl+d` (delete), `delete`, `ctrl+r` (rename), `ctrl+u` (update), `ctrl+a` (providerList), `meta+n` (agent:create), `ctrl+f` (favorite). These are all moved to component-level inline handlers in their respective dialogs.

---

### Component 4: Rewind Restore Options + Session Branch (8.6 + 8.2 merged)

*Complexity: Medium (1.5 days combined). Unified rewind action system.*

**Rationale for merging**: Both features modify `dialog-rewind.tsx` to add action menus on turn selection. Fork (8.2) is one of the actions in the restore menu (8.6). Implementing them separately would require two passes on the same dialog with overlapping code.

#### [NEW] [dialog-rewind-actions.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-rewind-actions.tsx)

Sub-dialog component rendered when the user presses Enter on a selected turn:

```tsx
type Props = {
  sessionID: string
  messageID: string
  turnLabel: string
  onComplete: () => void  // called after successful action to dismiss the rewind dialog
}

function DialogRewindActions({ sessionID, messageID, turnLabel, onComplete }: Props) {
  // DialogSelect with options:
  // 1. "Revert conversation" → sdk.client.project.session.revert({ sessionID, projectID, messageID })
  //    Toast: "Reverted to turn N (use /unrevert to undo)"
  //    Then: onComplete()
  //
  // 2. "Fork from here" → sdk.client.project.session.fork({ sessionID, projectID, messageID })
  //    Toast: "Session forked from turn N"
  //    Then: route.navigate({ type: "session", sessionID: newSession.id })
  //
  // 3. "Cancel" → dialog.pop()
}
```

**Error handling**: Both `revert` and `fork` must wrap SDK calls in try/catch. On failure, show `toast.error(e)`. No silent fallbacks per core mandates.

#### [MODIFY] [dialog-rewind.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-rewind.tsx)

1. **Replace the no-op `select:accept`** with pushing the `DialogRewindActions` sub-dialog:
   ```ts
   "select:accept": () => {
     if (!selectedMessage) return
     dialog.push(() => (
       <DialogRewindActions
         sessionID={session.sessionID!}
         messageID={selectedMessage.id}
         turnLabel={`Turn ${selectedIndex + 1}`}
         onComplete={() => dialog.clear()}
       />
     ))
   },
   ```

2. **Add direct-action keybindings**:
   ```ts
   "rewind:fork": () => { /* direct fork without menu */ },
   "rewind:revert": () => { /* direct revert without menu */ },
   ```

3. **Fork indicator**: On mount, query `sdk.client.project.session.children({ sessionID })` to get child session list. Show `⑂` icon next to turns that have child forks:
   ```ts
   const [childSessions, setChildSessions] = useState<Session[]>([])
   useEffect(() => {
     sdk.client.project.session.children({ sessionID, projectID: sdk.projectID })
       .then(res => { if (res.data) setChildSessions(res.data) })
       .catch(() => { /* children query is best-effort */ })
   }, [sessionID])
   ```

#### Rewind keybindings

The rewind dialog already registers the `Select` context. The `f` and `r` direct-action keys are handled via `useInput` inside `dialog-rewind.tsx` (not via the keybinding system) — matching Claude Code's pattern of keeping context-specific shortcuts as inline handlers:

```ts
useInput((input, _key) => {
  if (input === 'f') { /* direct fork */ }
  if (input === 'r') { /* direct revert */ }
})
```

---

### Component 5: Multi-Session Tabs (8.3)

*Complexity: High (2.5 days). New state management + context provider + keybinding integration.*

This is the most architecturally significant feature. I propose two design alternatives:

**Alternative A: `useSyncExternalStore`-based Store** (recommended)
- Same pattern as `message-queue-store.ts`
- Module-level state with `subscribe`/`getSnapshot` API
- Zero React overhead for tab switching
- Testable without React rendering context

**Alternative B: React Context + `useReducer`**
- Standard React pattern
- More idiomatic but slower for high-frequency operations (tab switching should be instant)
- Couples tab state to React tree lifecycle

**Decision**: Alternative A is clearly superior — it mirrors the established `message-queue-store.ts` pattern and provides the non-blocking, immediate state updates required for tab switching. No meaningful downsides.

#### [NEW] [session-tab-store.ts](file:///d:/liteai/packages/cli/src/tui/stores/session-tab-store.ts)

Module-level tab state store following the `useSyncExternalStore` pattern:

```ts
interface SessionTabState {
  readonly tabs: readonly string[]    // session IDs
  readonly activeIndex: number
}

// Public API:
function open(sessionID: string): void        // add tab or switch to existing
function close(sessionID: string): void       // remove tab, adjust activeIndex
function next(): void                          // cycle forward
function prev(): void                          // cycle backward
function setActive(index: number): void        // direct jump (alt+N)
function getActiveSessionID(): string | undefined

// Max tabs from env or default 5
const MAX_TABS = parseInt(process.env.LITEAI_MAX_SESSION_TABS ?? "5", 10)

// useSyncExternalStore interface:
function subscribe(listener: () => void): () => void
function getSnapshot(): SessionTabState
```

**Tab lifecycle rules**:
- Opening a session that's already in the tab ring → switch to it (no duplicate)
- Exceeding `MAX_TABS` → reject with toast "Maximum tabs reached"
- Closing the active tab → switch to the next tab (or previous if last)
- Closing the only tab → no-op (always keep at least one tab)

#### [NEW] [session-tabs-context.tsx](file:///d:/liteai/packages/cli/src/tui/context/session-tabs.tsx)

React context provider wrapping the `useSyncExternalStore` hook for convenient consumption. Mounted in `app.tsx` between `SessionProvider` and `AlternateScreen`.

```tsx
export function SessionTabsProvider({ children }: { children: React.ReactNode }) {
  const tabState = useSyncExternalStore(subscribe, getSnapshot)
  // ... provide via context
}
```

#### [MODIFY] [app.tsx](file:///d:/liteai/packages/cli/src/tui/app.tsx)

Wrap with `SessionTabsProvider`:
```tsx
<SessionProvider>
  <SessionTabsProvider>
    <AlternateScreen>
      <AppContent />
    </AlternateScreen>
  </SessionTabsProvider>
</SessionProvider>
```

#### [MODIFY] [routes/session/index.tsx](file:///d:/liteai/packages/cli/src/tui/routes/session/index.tsx)

When navigating to a session, call `open(sessionID)` on the tab store instead of just rendering:
```ts
useEffect(() => {
  openTab(sessionID)
}, [sessionID])
```

Session cleanup (`cleanupSession`) should only fire when a tab is **explicitly closed**, not on navigation.

#### [MODIFY] [status-line.tsx](file:///d:/liteai/packages/cli/src/tui/components/status-line.tsx)

Add tab indicator segment (priority 7.5, between code changes and session ID):
```ts
// Only when >1 tab is open
if (tabState.tabs.length > 1) {
  const tabText = tabState.tabs.map((_, i) =>
    i === tabState.activeIndex ? `•${i + 1}•` : `[${i + 1}]`
  ).join(' ')
  segments.push({ priority: 7.5, text: tabText, color: theme.textMuted as string })
}
```

#### [MODIFY] [dialog-session-list.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-session-list.tsx)

On session select, open in tab (call `openTab(sessionID)` instead of just navigating). Show `[N]` gutter indicator for sessions already open in a tab.

#### [MODIFY] [default-bindings.ts](file:///d:/liteai/packages/cli/src/tui/keybindings/default-bindings.ts)

Add to `Global` context (tab management is global, matching Claude Code's approach of using Global context for app-level actions):
```ts
"alt+1": "app:tab1",
"alt+2": "app:tab2",
"alt+3": "app:tab3",
"alt+4": "app:tab4",
"alt+5": "app:tab5",
"ctrl+w": "app:closeTab",  // matches Claude Code's Ctrl+W (worktree toggle) — repurposed for tab close in our tab model
```

Add global keybinding handler in `session/index.tsx`:
```ts
useKeybindings({
  "app:tab1": () => setActive(0),
  "app:tab2": () => setActive(1),
  // ... etc
  "app:closeTab": () => closeTab(sessionID),
}, { context: "Global", isActive: true })
```

> [!IMPORTANT]
> **Memory management**: Each open tab maintains its SSE subscription and message state in the app store. The `cleanupSession(id)` call must happen when a tab is closed to release the SSE subscription. The `MAX_TABS` cap prevents unbounded growth. This is enforced at the store level, not the component level.

---

## Summary of New Files

| File | Component | Purpose |
|---|---|---|
| `dialog-rewind-actions.tsx` | 8.6/8.2 | Rewind action sub-dialog (revert/fork/cancel) |
| `session-tab-store.ts` | 8.3 | Module-level tab state (useSyncExternalStore pattern) |
| `session-tabs.tsx` (context) | 8.3 | React context provider for tab state |

## Summary of Modified Files

| File | Components | Changes |
|---|---|---|
| `dialog-diff.tsx` | 8.5 | Aggregate summary header, file sorting |
| `ctx.tsx` | 8.4 | Add `showPreCompaction` to context |
| `session/index.tsx` | 8.4, 8.3 | ShowAll state toggle, tab integration |
| `session/messages.tsx` | 8.4 | Compaction-aware message filtering |
| `compact-summary.tsx` | 8.4 | Dynamic hint text |
| `dialog-session-list.tsx` | 8.1, 8.3 | Archive indicators, tab indicators |
| `dialog-rewind.tsx` | 8.6/8.2 | Action menu, fork indicator, direct keybindings |
| `default-bindings.ts` | 8.1, 8.6, 8.3 | New keybindings |
| `status-line.tsx` | 8.3 | Tab indicators segment |
| `app.tsx` | 8.3 | SessionTabsProvider |

---

## Verification Plan

### Automated Tests
- `bun typecheck` in `packages/cli` after each component
- `bun lint:fix` in `packages/cli` after each component

### Manual Verification
1. **8.5 Patch Summary**: Run a session with multiple file edits → open diff dialog (`ctrl+d`) → verify summary header with totals and file type breakdown → verify A/M/D sort order
2. **8.4 Show All**: Compact a session → enter transcript mode (`ctrl+o`) → press `ctrl+e` → verify pre-compaction messages appear with divider → toggle off → verify messages collapse
3. **8.1 Archive**: Open session list → `ctrl+u` on a session → verify `📦` icon + dimmed text + toast → `ctrl+shift+a` → verify archived-only view → unarchive → verify restored
4. **8.6/8.2 Rewind**: Open rewind (`ctrl+x r`) → select a turn → press Enter → verify action menu (Revert/Fork/Cancel) → test revert flow → test fork flow → verify navigation to forked session → verify `⑂` indicator on turns with forks
5. **8.3 Multi-Session**: Open 3 sessions from session list → verify tab indicators in status line → `alt+1`/`alt+2`/`alt+3` → verify switching → `ctrl+w` to close middle tab → verify order adjusts → verify cleanup fires

### Post-Completion
- Update `ui_feature_status.md`: mark all 6 items as ✅
- Update summary table to 100%
- Move `roadmap/ui_refactoring/` to `roadmap/done/ui_refactoring/`
