import { Session } from ".."
import type { Message } from "../message"
import type { MessageID, PartID, SessionID } from "../schema"

/**
 * Discriminated union representing a deferred database write operation.
 *
 * EventPersister accumulates these ops in an in-memory write queue instead
 * of calling Session.updatePart/updatePartDelta/updateMessage synchronously
 * during event processing. The consumer (loop.ts) drains the queue and
 * delegates to AsyncPersistenceWriter for actual DB writes.
 */
export type PersistenceOp =
  | { type: "upsert-part"; part: Message.Part }
  | {
      type: "delta-part"
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
      field: string
      delta: string
    }
  | { type: "upsert-message"; message: Message.Assistant }

/**
 * Async consumer that drains PersistenceOp[] and writes to the database.
 *
 * Separates DB write concerns from the EventPersister's in-memory
 * accumulation logic. Called by loop.ts after each event batch and
 * after persister.flush().
 *
 * Pattern source: Claude Code MVP — generator is pure, consumer
 * handles persistence.
 */
export class AsyncPersistenceWriter {
  async write(ops: PersistenceOp[]): Promise<void> {
    for (const op of ops) {
      switch (op.type) {
        case "upsert-part":
          await Session.updatePart(op.part)
          break
        case "delta-part":
          await Session.updatePartDelta(op)
          break
        case "upsert-message":
          await Session.updateMessage(op.message)
          break
      }
    }
  }
}
