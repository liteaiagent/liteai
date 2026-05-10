# Part 1: Mode Detection + Session Persistence

> **Parent:** [Implementation Plan](file:///C:/Users/ahmed/.gemini/antigravity/brain/47fd34a1-ae4d-4a83-b0d9-2f86648113e9/implementation_plan.md)

---

## 1. Flag Registration

#### [MODIFY] [flag.ts](file:///d:/liteai/packages/core/src/flag/flag.ts)

Add `LITEAI_COORDINATOR_MODE` as a **dynamic getter** (not a static const). Coordinator mode must be readable at access time because `matchSessionMode()` may mutate the env var on session resume.

```diff
 export declare const LITEAI_FORK_SUBAGENT: boolean
+export declare const LITEAI_COORDINATOR_MODE: boolean
 export const LITEAI_SERVER_PASSWORD = env("SERVER_PASSWORD")
```

```diff
+// Dynamic getter for LITEAI_COORDINATOR_MODE
+// Must be evaluated at access time, not module load time,
+// because matchSessionMode() may flip the env var on session resume.
+Object.defineProperty(Flag, "LITEAI_COORDINATOR_MODE", {
+  get() {
+    return truthy("COORDINATOR_MODE")
+  },
+  enumerable: true,
+  configurable: false,
+})
```

**Why dynamic:** The reference implementation mutates `process.env.CLAUDE_CODE_COORDINATOR_MODE` in `matchSessionMode()`. While our primary mode source is the DB-persisted `Session.Info.sessionMode`, we still support the env var for startup configuration and for `matchSessionMode()` drift correction. A static `const` would capture the value at module load time and never reflect runtime changes.

---

## 2. Coordinator Mode Detection

#### [NEW] [coordinator-mode.ts](file:///d:/liteai/packages/core/src/coordinator/coordinator-mode.ts)

```typescript
import { Log } from "@liteai/util/log"
import type { Session } from "../session"
import { Flag } from "../flag/flag"
import { Brand } from "../brand"

const logger = Log.create({ service: "coordinator" })

/**
 * Check if the given session is in coordinator mode.
 * 
 * The authoritative source is the session's persisted `sessionMode` field.
 * Falls back to the `LITEAI_COORDINATOR_MODE` flag for new sessions
 * where the mode hasn't been persisted yet.
 * 
 * This is a pure function — no global state mutation, multi-tenant safe.
 * 
 * Reference: coordinatorMode.ts:36-41 — `isCoordinatorMode()`
 */
export function isCoordinatorMode(
  sessionMode?: Session.Info["sessionMode"]
): boolean {
  // If we have a persisted session mode, use it as the authoritative source
  if (sessionMode !== undefined) {
    return sessionMode === "Coordinator"
  }
  // Fallback for pre-session contexts (e.g., session creation)
  return Flag.LITEAI_COORDINATOR_MODE
}
```

**Design notes:**
- The reference's `isCoordinatorMode()` is a global function reading a global env var. Ours takes `sessionMode` as a parameter, making it session-scoped and testable.
- The fallback to `Flag.LITEAI_COORDINATOR_MODE` covers the window between process startup and session creation.

---

## 3. Session Mode Matching (Resume Drift Detection)

Same file: `coordinator-mode.ts`

```typescript
/**
 * Checks if the current coordinator mode flag matches the session's stored mode.
 * 
 * Called on session resume to prevent mode drift — e.g., user starts a session
 * in coordinator mode, restarts the server without the flag, resumes the session.
 * 
 * Unlike the reference which mutates process.env, we:
 * 1. Return the correct mode for the caller to use
 * 2. Optionally flip the env var so Flag.LITEAI_COORDINATOR_MODE stays in sync
 *    (defense-in-depth for code that reads the flag directly)
 * 3. Log the drift for observability
 * 
 * Reference: coordinatorMode.ts:49-78 — `matchSessionMode()`
 */
export function matchSessionMode(
  sessionMode: Session.Info["sessionMode"] | undefined
): { 
  resolvedMode: Session.Info["sessionMode"]
  warning?: string 
} {
  // No stored mode (new session or pre-mode-tracking session) — use flag
  if (!sessionMode) {
    const mode = Flag.LITEAI_COORDINATOR_MODE ? "Coordinator" : "Normal"
    return { resolvedMode: mode }
  }

  const flagIsCoordinator = Flag.LITEAI_COORDINATOR_MODE
  const sessionIsCoordinator = sessionMode === "Coordinator"

  if (flagIsCoordinator === sessionIsCoordinator) {
    return { resolvedMode: sessionMode }
  }

  // Drift detected — session mode wins (it's the authoritative source)
  // Flip the env var so Flag.LITEAI_COORDINATOR_MODE stays in sync
  if (sessionIsCoordinator) {
    process.env[`${Brand.env}COORDINATOR_MODE`] = "true"
  } else {
    delete process.env[`${Brand.env}COORDINATOR_MODE`]
  }

  const warning = sessionIsCoordinator
    ? "Entered coordinator mode to match resumed session."
    : "Exited coordinator mode to match resumed session."

  logger.warn("coordinator mode drift detected", {
    sessionMode,
    flagWas: flagIsCoordinator,
    resolvedTo: sessionMode,
  })

  return { resolvedMode: sessionMode, warning }
}
```

**Key difference from reference:**
- Returns a structured result `{ resolvedMode, warning }` instead of `string | undefined`. The caller can use `resolvedMode` directly without re-reading the flag.
- Uses `Brand.env` prefix for env var key consistency.
- Session mode is the authoritative source — the env var flip is defense-in-depth only.

---

## 4. Session Creation Wiring

#### [MODIFY] [session/index.ts](file:///d:/liteai/packages/core/src/session/index.ts) — `createNext()`

The `createNext()` function already sets `sessionMode: "Normal"` on line 481. We need to make it coordinator-aware:

```diff
 export async function createNext(input: {
   id?: SessionID
   title?: string
   parentID?: SessionID
   workspaceID?: WorkspaceID
   directory: string
+  sessionMode?: Session.Info["sessionMode"]
 }) {
   const result: Info = {
     id: SessionID.descending(input.id),
     slug: Slug.create(),
     version: Installation.VERSION,
     projectID: Instance.project.id,
     directory: input.directory,
     workspaceID: input.workspaceID,
     parentID: input.parentID,
     title: input.title ?? createDefaultTitle(!!input.parentID),
     time: {
       created: Date.now(),
       updated: Date.now(),
     },
-    sessionMode: "Normal" as const,
+    sessionMode: input.sessionMode ?? "Normal" as const,
     toolProfile: "Plan" as const,
     forkEnabled: false,
   }
```

**Where the mode is set:** The caller of `createNext()` (typically `Session.create()` or `SessionPrompt.start()`) will check `isCoordinatorMode()` and pass the appropriate mode. This is done in the engine's session start path — see Part 3 for the wiring.

---

## 5. Fork Gate Wiring

#### [MODIFY] [fork.ts](file:///d:/liteai/packages/core/src/agent/fork.ts) — `isForkSubagentEnabled()`

Currently `ForkGateContext.isCoordinator` is a static boolean passed by the caller. We need the call sites to provide the live session mode:

The `isForkSubagentEnabled()` function already checks `context?.isCoordinator` (line 173). No changes needed to the function itself. The change is at the **call site** in `runner.ts` or wherever `isForkSubagentEnabled()` is invoked — it must pass `isCoordinator: isCoordinatorMode(session.sessionMode)`.

```diff
 // In the fork decision path (runner.ts or lifecycle.ts):
 const forkEnabled = isForkSubagentEnabled({
-  isCoordinator: false, // TODO: wire to coordinator mode
+  isCoordinator: isCoordinatorMode(session.sessionMode),
   isNonInteractive: session.toolProfile === "Fast",
 })
```

> [!NOTE]
> The exact call site needs to be located. This is a grep for `isForkSubagentEnabled` to find all callers.

---

## 6. Barrel Export

#### [NEW] [coordinator/index.ts](file:///d:/liteai/packages/core/src/coordinator/index.ts)

```typescript
export {
  isCoordinatorMode,
  matchSessionMode,
  getCoordinatorUserContext,
  applyCoordinatorToolFilter,
} from "./coordinator-mode"

export { getCoordinatorSystemPrompt } from "./coordinator-prompt"
```
