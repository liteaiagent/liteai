# Bug Fix: TUI Session Cancellation & Infinite Loading

**Status:** ✅ Complete

## Problem
The TUI frequently became stuck in an infinite loading state (spinner) when an early error occurred in the engine (such as a missing provider or model configuration). In this state, pressing the `Esc` key failed to cancel or unstick the session, leaving the user with no choice but to forcefully terminate the CLI. Additionally, the error message was always generic ("Session encountered an error") and appeared twice.

## Root Cause Analysis

### Phase 1 — Connection Dangling & State Mismanagement (fixed previously)

1. **Dangling HTTP Connection** — When `queryLoop` failed early (e.g., `ModelNotFoundError`), no assistant message was created, causing `Message.stream` to block indefinitely and keeping the HTTP connection open.
2. **No Auto-Recovery** — The `session.error` SSE handler did not update `session_status` to `idle`, so `selectIsWorking` stayed `true`.
3. **Failed Esc Cancellation** — The `/status` fetch after abort wiped local `idle` states by replacing the map with only busy sessions.

### Phase 2 — Unhandled Rejection, Cascade, and Error Shape (fixed in this iteration)

4. **Unhandled Promise Rejection** — The `/message` route handler called `stream.close()` then `throw e`. After stream close, Hono cannot catch the error—it escapes as an unhandled promise rejection, destabilizing the runtime.
5. **SSE Reconnection Cascade** — `onSessionError` depended on the full `toast` context object, which changes identity every time a toast is shown (because `useMemo` includes the reactive `toasts` array). Each toast triggered: callback identity change → `handleEvent` identity change → `useEffect` cleanup → SSE teardown → reconnect → bootstrap. This caused 4 consecutive bootstrap cycles after a single error.
6. **Wrong Error Shape Access** — `onSessionError` read `err?.message` but the NamedError shape is `{ name: "...", data: { message: "..." } }`. The message always fell through to the generic fallback.
7. **Duplicate Toast** — Both the HTTP catch (`toast.error(e)`) and the SSE handler (`toast.show(...)`) fired for the same error.

## Changes Implemented

### 1. Explicit Stream Teardown (Phase 1)
**File:** `packages/core/src/server/routes/session.ts`
- Added `stream.close()` inside the catch block of the `/message` route.

### 2. Remove Re-throw After Stream Close (Phase 2)
**File:** `packages/core/src/server/routes/session.ts`
- Removed `throw e` after `stream.close()`. The error is already published via `Bus.publish(Session.Event.Error)` in the engine. Re-throwing after the stream is closed creates an unhandled promise rejection. Replaced with `log.error()` for server-side visibility.

### 3. Event-Driven Auto-Recovery (Phase 1)
**File:** `packages/cli/src/tui/state/app-state-events.ts`
- `session.error` SSE handler injects `{ type: "idle" }` into `session_status`.

### 4. Fix Error Message Extraction (Phase 2)
**File:** `packages/cli/src/tui/state/app-state-context.tsx`
- Changed `err?.message` to `err?.data?.message` to correctly extract the descriptive error message from the NamedError discriminated union shape.

### 5. Remove Duplicate Toast (Phase 2)
**File:** `packages/cli/src/tui/context/session.tsx`
- Removed `toast.error(e)` from the `submit()` catch block. The SSE `session.error` handler is the single source of truth for user-facing error display. Removed `toast` from the dependency array.

### 6. Stabilize SSE Callback Dependencies (Phase 2)
**File:** `packages/cli/src/tui/state/app-state-context.tsx`
- Changed `onSessionError` dependency from `[toast]` (full context object) to `[toastShow]` (stable `useCallback` with zero deps). This prevents the SSE reconnection cascade triggered by toast state changes.

### 7. Hard Fallback in Prompt Submission (Phase 1)
**File:** `packages/cli/src/tui/context/session.tsx`
- `submit()` catch block forces `session_status` to `idle` as a defensive measure.

### 8. Reliable Status Polling on Abort (Phase 1)
**File:** `packages/cli/src/tui/context/session.tsx`
- `abort()` merges server status and injects `idle` if session is not in the busy list.
