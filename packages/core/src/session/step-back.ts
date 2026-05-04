import { NamedError } from "@liteai/util/error"
import z from "zod"
import type { ModelID, ProviderID } from "@/provider/schema"
import { Database, eq } from "@/storage/db"
import { Bus } from "../bus"
import { Snapshot } from "../snapshot"
import { Session } from "."
import { SessionPrompt } from "./engine"
import { CheckpointNotFoundError, CheckpointStoreManager } from "./engine/loop/checkpoint-store"
import { Message } from "./message"
import { MessageID, PartID, SessionID } from "./schema"
import { MessageTable, SessionTable } from "./session.sql"

export const StepBackInput = z.object({
  sessionID: SessionID.zod,
  checkpointID: z.string(),
  guidance: z.string().optional(),
})
export type StepBackInput = z.infer<typeof StepBackInput>

// ─── Errors (NamedError-based for structured error handling per §5) ──────────

const FileConflictData = z.object({
  message: z.string(),
  conflicts: z.array(z.string()),
})
export class FileConflictError extends NamedError.create("FileConflictError", FileConflictData) {
  constructor(conflicts: string[]) {
    super({
      message: `File conflict: Workspace files have been modified since the checkpoint: ${conflicts.join(", ")}`,
      conflicts,
    })
  }
}

const CheckpointEmptyMessagesData = z.object({
  checkpointID: z.string(),
  sessionID: z.string(),
})
export class CheckpointEmptyMessagesError extends NamedError.create(
  "CheckpointEmptyMessagesError",
  CheckpointEmptyMessagesData,
) {}

const SnapshotTrackingData = z.object({
  message: z.string(),
  cause: z.string().optional(),
})
export class SnapshotTrackingError extends NamedError.create("SnapshotTrackingError", SnapshotTrackingData) {}

// Re-export from checkpoint-store for route handler convenience
export { CheckpointNotFoundError } from "./engine/loop/checkpoint-store"

/**
 * Perform a destructive step-back to a prior checkpoint.
 *
 * Checkpoint operations are handled via `CheckpointStoreManager` — a pure
 * in-memory static utility with no dependency on the persistence backend.
 */
export async function stepBack(input: StepBackInput) {
  SessionPrompt.assertNotBusy(input.sessionID)

  // 2. Retrieve checkpoint from the centralized in-memory store
  const checkpoint = CheckpointStoreManager.getCheckpoint(input.sessionID, input.checkpointID)
  if (!checkpoint) {
    throw new CheckpointNotFoundError({ checkpointID: input.checkpointID, sessionID: input.sessionID })
  }

  // Defensive guard against empty message state (should never happen)
  if (checkpoint.messages.length === 0) {
    throw new CheckpointEmptyMessagesError({
      checkpointID: input.checkpointID,
      sessionID: input.sessionID,
    })
  }

  // 3. Conflict detection: detect EXTERNAL modifications only.
  // Agent-produced changes between checkpoints are expected (the agent wrote them
  // in subsequent steps — they will be undone by the restore). External modifications
  // are changes made to the working tree AFTER the last agent step (latest checkpoint).
  //
  // Algorithm:
  //   - Compare current working tree against the LATEST checkpoint's snapshot
  //   - If files differ → those were modified externally → conflict
  //   - If no diff → safe to restore to target checkpoint
  //
  // If snapshot is undefined on the target (e.g. step 1), skip restore but still
  // perform conflict detection against the latest checkpoint.
  const allCheckpoints = CheckpointStoreManager.listCheckpoints(input.sessionID)
  const latestCheckpoint = allCheckpoints.length > 0 ? allCheckpoints[allCheckpoints.length - 1] : undefined

  if (latestCheckpoint?.snapshot) {
    await Snapshot.track().catch((e) => {
      throw new SnapshotTrackingError({
        message: "Cannot perform conflict detection: Workspace snapshot tracking failed.",
        cause: e instanceof Error ? e.message : String(e),
      })
    })
    const patch = await Snapshot.patch(latestCheckpoint.snapshot)
    if (patch.files.length > 0) {
      throw new FileConflictError(patch.files)
    }
  }

  // 4. Restore file state to the TARGET checkpoint's snapshot
  if (checkpoint.snapshot) {
    await Snapshot.restore(checkpoint.snapshot)
  }

  // 5. Truncate messages in DB
  const msgs = await Session.messages({ sessionID: input.sessionID })
  const checkpointMessageIDs = new Set(checkpoint.messages.map((m) => m.info.id))

  // Find the first message ID that is NOT in the checkpoint
  const firstMessageToRemove = msgs.find((m) => !checkpointMessageIDs.has(m.info.id))

  if (firstMessageToRemove) {
    const removeStartID = firstMessageToRemove.info.id
    // MessageID.ascending() generates ULID-based IDs with lexicographic ordering.
    // This >= comparison relies on that monotonic encoding contract.
    const remove = msgs.filter((m) => m.info.id >= removeStartID)

    for (const msg of remove) {
      Database.use((db) => db.delete(MessageTable).where(eq(MessageTable.id, msg.info.id)).run())
      await Bus.publish(Message.Event.Removed, { sessionID: input.sessionID, messageID: msg.info.id })
    }
  }

  // 6. Truncate checkpoints
  CheckpointStoreManager.truncateCheckpointsAfter(input.sessionID, input.checkpointID)

  // 7. Detect orphaned children
  const children = Database.use((db) =>
    db.select().from(SessionTable).where(eq(SessionTable.parent_id, input.sessionID)).all(),
  )
  const orphanedChildren = children.filter((c) => c.time_created > checkpoint.timestamp).map((c) => c.id)

  // 8. Inject guidance
  if (input.guidance) {
    const messageID = MessageID.ascending()

    await Session.updateMessage({
      id: messageID,
      sessionID: input.sessionID,
      role: "user",
      agent: "unknown",
      variant: "default",
      time: { created: Date.now() },
      model: { providerID: "unknown" as ProviderID, modelID: "unknown" as ModelID },
    })

    await Session.updatePart({
      id: PartID.ascending(),
      sessionID: input.sessionID,
      messageID: messageID,
      type: "text",
      text: input.guidance,
      synthetic: true,
    })
  }

  // 9. Emit events
  const session = await Session.get(input.sessionID)
  Bus.publish(Session.Event.Updated, { info: session })

  // 10. Return result
  return {
    restored: true,
    step: checkpoint.step,
    orphanedChildren,
  }
}
