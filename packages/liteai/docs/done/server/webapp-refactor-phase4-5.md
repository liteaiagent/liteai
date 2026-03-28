# Web App Refactor — Phase 4-5: Navigation + Session

## Phase 4: Navigation + Layout

### 4.1 `directory-layout.tsx`

**File**: `src/pages/directory-layout.tsx`

The `params.dir` value (base64-encoded directory) IS the projectID.

```diff
+import { toProjectID } from "@/utils/project-id"

 globalSDK
   .createClient({ directory: raw, throwOnError: true })
-  .project.current()
+  .project.get({ projectID: toProjectID(raw) })
```

Consider renaming the route param from `:dir` to `:projectID` in `app.tsx` for clarity (optional, cosmetic).

---

### 4.2 `navigation.ts` (HEAVY — 11+ SDK calls)

**File**: `src/pages/layout/navigation.ts`

```diff
+import { toProjectID } from "@/utils/project-id"
```

| Line | Current Call | Updated Call |
|------|-------------|-------------|
| 117 | `client.worktree.list({ directory: root })` | `client.worktree.list({ projectID: toProjectID(root) })` |
| 136 | `client.session.get({ sessionID: target.id })` | Add `projectID: toProjectID(directory)` — note: need to determine which directory |
| 171 | `client.session.list({ directory: item })` | `client.session.list({ projectID: toProjectID(item) })` |
| 193 | `client.project.create({ directory })` | **No change** (project CRUD, not project-scoped) |
| 230 | `client.project.archive({ projectID })` | **No change** |
| 262 | `client.project.update({ projectID, name })` | **No change** |
| 275 | `client.session.update({ directory, sessionID, time })` | Replace `directory` with `projectID: toProjectID(directory)` |
| 299 | `client.session.update({ directory, sessionID, time })` | Replace `directory` with `projectID: toProjectID(session.directory)` |
| 318 | `client.project.unarchive({ projectID })` | **No change** |
| 328 | `client.session.delete({ directory, sessionID })` | Replace `directory` with `projectID: toProjectID(session.directory)` |
| 374 | `client.session.update({ directory, sessionID, title })` | Replace `directory` with `projectID: toProjectID(session.directory)` |

> **Pattern**: For functions that receive a `Session` object, use `toProjectID(session.directory)`. For functions that receive raw `directory` strings, use `toProjectID(directory)`.

---

### 4.3 `sidebar-workspace.tsx`

**File**: `src/pages/layout/sidebar-workspace.tsx`

- Line ~558: Session SDK calls → add `projectID`

---

### 4.4 `workspace-ops.ts`

**File**: `src/pages/layout/workspace-ops.ts`

| Line | Call | Change |
|------|------|--------|
| 49 | `client.worktree.list/create/etc.` | Add `projectID` |
| 111 | `client.session.list({ directory })` | Replace with `{ projectID }` |
| 121 | `client.instance.dispose({ directory })` | Replace with `{ projectID }` |
| 123 | `client.worktree.*` | Add `projectID` |

---

### 4.5 `workspace-dialogs.tsx`

**File**: `src/pages/layout/workspace-dialogs.tsx`

- L33, L102: `client.file.*` calls → add `projectID`
- L93: `client.session.list(...)` → add `projectID`

---

### 4.6 `prefetch.ts`

**File**: `src/pages/layout/prefetch.ts`

- L124: `client.session.messages({ directory, sessionID, limit })` → replace `directory` with `projectID`

---

## Phase 5: Session Page + Components

### 5.1 `session.tsx` (HEAVY — ~55KB)

**File**: `src/pages/session.tsx`

Uses `useSDK()` which now provides `sdk.projectID` (from Phase 1.2).

| Line | Call | Change |
|------|------|--------|
| 656 | `sdk.client.project.*` | Depends on method |
| 1469 | `sdk.client.session.abort({ sessionID })` | Add `projectID: sdk.projectID` |
| 1474 | `sdk.client.session.create/init` | Add `projectID` |
| 1502 | `sdk.client.session.revert(input)` | Add `projectID` to input |
| 1538 | `sdk.client.session.unrevert` | Add `projectID` |
| 1540 | `sdk.client.session.revert` | Add `projectID` |

---

### 5.2 `use-session-commands.tsx`

**File**: `src/pages/session/use-session-commands.tsx`

| Line | Call | Change |
|------|------|--------|
| 200 | `sdk.client.session.share(...)` | Add `projectID` |
| 224 | `sdk.client.session.unshare(...)` | Add `projectID` |
| 417 | `sdk.client.session.abort(...)` | Add `projectID` |
| 422 | `sdk.client.session.revert(...)` | Add `projectID` |
| 445 | `sdk.client.session.unrevert(...)` | Add `projectID` |
| 451 | `sdk.client.session.revert(...)` | Add `projectID` |
| 473 | `sdk.client.session.summarize(...)` | Add `projectID` |

---

### 5.3 `trace-panel.tsx`

**File**: `src/pages/session/trace-panel.tsx`

Lines 90, 96, 107, 117, 194, 199: All `sdk.client.session.trace.*` calls → add `projectID`.

---

### 5.4 `message-timeline.tsx`

**File**: `src/pages/session/message-timeline.tsx`

| Line | Call | Change |
|------|------|--------|
| 345 | `globalSDK.client.session.share({ sessionID, directory })` | Replace `directory` with `projectID` |
| 361 | `globalSDK.client.session.unshare({ sessionID, directory })` | Replace `directory` with `projectID` |
| 428, 469, 496 | `sdk.client.session.*` | Add `projectID` |

---

### 5.5 `review-tab.tsx`

**File**: `src/pages/session/review-tab.tsx`

- L50: `sdk.client.file.*` → add `projectID`

---

### 5.6 `session-question-dock.tsx`

**File**: `src/pages/session/composer/session-question-dock.tsx`

- L135: `sdk.client.question.reply(...)` → add `projectID`
- L151: `sdk.client.question.reject(...)` → add `projectID`

---

### 5.7 `session-composer-state.ts`

**File**: `src/pages/session/composer/session-composer-state.ts`

- L135: `sdk.client.permission.*` → add `projectID`

---

### 5.8 `prompt-input/submit.ts`

**File**: `src/components/prompt-input/submit.ts`

- L348: `sdk.createClient({ directory })` — keep `directory` for client creation. Ensure subsequent project-scoped calls on this client include `projectID`.
