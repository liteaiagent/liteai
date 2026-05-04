# Backward Execution: Architectural Observation Fixes

Cross-referencing the live implementation against the spec, the implementation_review.md, LangGraph's `BaseCheckpointSaver`, and Claude Code patterns. The previous review resolved 9 issues. This audit identifies **6 remaining architectural defects** that were either introduced during the fixes, were not caught in the first review, or violate §5 (Fail-Fast) and §1 (DI purity) mandates.

## Proposed Changes

### Issue A — Duplicated `CheckpointStore` Boilerplate Across Checkpointer Implementations (DRY Violation)

> [!IMPORTANT]
> Both `SqliteCheckpointer` and `MemoryCheckpointer` independently duplicate `private static readonly globalStores` and the entire 7-method `getCheckpointStore/captureCheckpoint/getCheckpoint/getCheckpointByStep/listCheckpoints/truncateCheckpointsAfter/clearSession` surface. This is a textbook Template Method / mixin candidate.

**Current state**: ~60 lines of identical code duplicated across 2 classes ([checkpointer.ts L43-123](file:///d:/liteai/packages/core/src/session/engine/loop/checkpointer.ts#L43-L123) and [checkpointer.ts L126-231](file:///d:/liteai/packages/core/src/session/engine/loop/checkpointer.ts#L126-L231))

**Fix**: Extract a `CheckpointStoreMixin` abstract base or a composed `CheckpointStoreManager` utility class that both `SqliteCheckpointer` and `MemoryCheckpointer` delegate to. The `NoopCheckpointer` keeps its throw-on-write semantics.

**Pattern**: Composition via a shared `CheckpointStoreManager` class. Both `SqliteCheckpointer` and `MemoryCheckpointer` hold a `private readonly checkpointManager: CheckpointStoreManager` and delegate checkpoint lifecycle calls to it.

---

### Issue B — `console.error` in HTTP Route Handler (§5 Violation)

> [!WARNING]
> [session.ts L1304](file:///d:/liteai/packages/core/src/server/routes/session.ts#L1304) uses `console.error` for the auto-resume error path. All logging must flow through the structured `Log` utility per project standards. `console.error` bypasses log levels, structured metadata, and observability pipelines.

**Fix**: Replace `console.error(...)` with `log.error(...)` using the route-scoped logger.

#### [MODIFY] [session.ts](file:///d:/liteai/packages/core/src/server/routes/session.ts)
- L1304: Replace `console.error("auto-resume failed for forked session", e)` → `log.error("auto-resume failed for forked session", { error: e, sessionID: newSession.id })`

---

### Issue C — `stepBack` Untyped `Error` for Empty Checkpoint Messages (§5 Violation)

> [!IMPORTANT]
> [step-back.ts L59](file:///d:/liteai/packages/core/src/session/step-back.ts#L59) throws a plain `new Error(...)` for the "empty message state" guard. Per §5, all error paths must use typed `NamedError` classes for structured detection at call sites.

**Fix**: Create a `CheckpointEmptyMessagesError` NamedError and use it instead.

#### [MODIFY] [step-back.ts](file:///d:/liteai/packages/core/src/session/step-back.ts)
- Create `CheckpointEmptyMessagesError` NamedError class
- Replace `throw new Error("Invalid checkpoint: Message state is empty")` with the typed error

---

### Issue D — `stepBack` Untyped `Error` for Snapshot Tracking Failure (§5 Violation)

> [!IMPORTANT]
> [step-back.ts L79-81](file:///d:/liteai/packages/core/src/session/step-back.ts#L79-L81) wraps `Snapshot.track()` failures in a plain `new Error(...)`. This generic error is indistinguishable from other runtime errors at the route handler level.

**Fix**: Create a `SnapshotTrackingError` NamedError and use it instead. The route handler can then map it to a `500` status with a clear diagnostic.

#### [MODIFY] [step-back.ts](file:///d:/liteai/packages/core/src/session/step-back.ts)
- Create `SnapshotTrackingError` NamedError class
- Replace the `.catch()` re-throw with the typed error

---

### Issue E — `cleanup()` Instantiates a Throwaway `SqliteCheckpointer` to Access a Static Map

> [!WARNING]
> [loop.ts L339](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L339): `new SqliteCheckpointer().clearSession(sessionID)` instantiates a full `Checkpointer` object just to call `clearSession()`, which is a thin wrapper around `SqliteCheckpointer.globalStores.delete(sessionID)` — a static map operation. This is architecturally incoherent: the instance has no state relevant to the call.

**Fix**: Make `clearSession` a static method on `SqliteCheckpointer`, or better, expose a static `clearSessionStore(sessionID)` helper that both `SqliteCheckpointer` and `MemoryCheckpointer` delegate to from the `CheckpointStoreManager`.

Since Issue A introduces `CheckpointStoreManager`, this fix becomes: `CheckpointStoreManager.clearSession(sessionID)` — a direct static call with no throwaway instance.

#### [MODIFY] [loop.ts](file:///d:/liteai/packages/core/src/session/engine/loop.ts)
- Replace `new SqliteCheckpointer().clearSession(sessionID)` with direct static call to `CheckpointStoreManager.clearSession(sessionID)`

---

### Issue F — `Checkpoint` Bus Event Schema Uses `z.any()` for Metadata

> [!WARNING]
> [status.ts L58](file:///d:/liteai/packages/core/src/session/status.ts#L58): `metadata: z.any()` undermines the Bus contract. The `CheckpointMetadata` schema is well-defined — it should be used directly for runtime validation.

**Fix**: Import `CheckpointMetadata` as a Zod schema (or create one) and reference it in the Bus event definition instead of `z.any()`.

#### [MODIFY] [status.ts](file:///d:/liteai/packages/core/src/session/status.ts)
- Replace `metadata: z.any()` with a proper Zod schema matching the `CheckpointMetadata` interface
#### [MODIFY] [checkpoint-store.ts](file:///d:/liteai/packages/core/src/session/engine/loop/checkpoint-store.ts)
- Export a `CheckpointMetadataSchema` Zod object alongside the interface

---

## Summary Table

| # | Issue | Severity | Files |
|---|-------|----------|-------|
| A | Duplicated `CheckpointStore` boilerplate across checkpointers | 🟠 DRY | checkpointer.ts |
| B | `console.error` in fork-at route handler | 🟡 §5 | session.ts (routes) |
| C | Untyped error for empty checkpoint messages | 🟡 §5 | step-back.ts |
| D | Untyped error for snapshot tracking failure | 🟡 §5 | step-back.ts |
| E | Throwaway instance to access static map | 🟡 Design | loop.ts |
| F | `z.any()` for `CheckpointMetadata` in Bus event | 🟡 Contract | status.ts, checkpoint-store.ts |

## Open Questions

> [!IMPORTANT]
> **Issue A scope**: The `CheckpointStoreManager` extraction is a moderate refactor touching `checkpointer.ts`, `loop.ts`, `step-back.ts`, and potentially `session/index.ts`. It simplifies Issues A and E simultaneously. However, it does change the `Checkpointer` interface shape — removing the checkpoint lifecycle methods from the interface and having them only on the manager. Should I keep the `Checkpointer` interface unchanged and only extract the implementation boilerplate, or should I narrow the interface too?

## Verification Plan

### Automated Tests
- `bun typecheck` scoped to `packages/core`
- `bun lint:fix` scoped to `packages/core`

### Manual Verification
- Walk through the step-back and fork-at code paths to confirm error types are correctly matched in route handlers
