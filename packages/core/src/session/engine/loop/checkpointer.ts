import { Session } from "../.."
import { Message } from "../../message"
import type { MessageID, PartID, SessionID } from "../../schema"
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

export interface Checkpointer {
  loadHistory(sessionID: SessionID): Promise<Message.WithParts[]>
  write(ops: PersistenceOp[]): Promise<void>
  saveMessage(msg: Message.Assistant | Message.User): Promise<Message.Assistant | Message.User>
  savePart(part: Message.Part): Promise<Message.Part>
  updateMessage(msg: Message.Assistant): Promise<void>
  deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void>
  dispose(): Promise<void>
}

export type SessionResult =
  | { status: "ok"; message: Message.WithParts }
  | { status: "error"; error: unknown; message?: Message.WithParts }
  | { status: "aborted" }

export class SqliteCheckpointer implements Checkpointer {
  async loadHistory(sessionID: SessionID): Promise<Message.WithParts[]> {
    return Message.filterCompacted(Message.stream(sessionID))
  }

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

  async saveMessage(msg: Message.Assistant | Message.User) {
    return Session.updateMessage(msg) as Promise<Message.Assistant | Message.User>
  }

  async savePart(part: Message.Part) {
    return Session.updatePart(part) as Promise<Message.Part>
  }

  async updateMessage(msg: Message.Assistant): Promise<void> {
    await Session.updateMessage(msg)
  }

  async deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void> {
    await Session.removePart(ref)
  }

  async dispose(): Promise<void> {
    /* DB connections managed externally */
  }
}

export class MemoryCheckpointer implements Checkpointer {
  private messages = new Map<string, Message.WithParts[]>()

  async loadHistory(sessionID: SessionID): Promise<Message.WithParts[]> {
    return this.messages.get(sessionID) ?? []
  }

  async write(ops: PersistenceOp[]): Promise<void> {
    for (const op of ops) {
      switch (op.type) {
        case "upsert-part":
          await this.savePart(op.part)
          break
        case "upsert-message": {
          const msgs = this.messages.get(op.message.sessionID) ?? []
          const idx = msgs.findIndex((m) => m.info.id === op.message.id)
          if (idx >= 0) msgs[idx] = { ...msgs[idx], info: op.message }
          break
        }
        case "delta-part": {
          const msgs = this.messages.get(op.sessionID) ?? []
          for (const m of msgs) {
            const part = m.parts.find((p: Message.Part) => p.id === op.partID)
            if (part && op.field in part) {
              ;(part as Record<string, unknown>)[op.field] =
                (((part as Record<string, unknown>)[op.field] as string) ?? "") + op.delta
              break
            }
          }
          break
        }
      }
    }
  }

  async saveMessage(msg: Message.Assistant | Message.User) {
    const sid = msg.sessionID
    const msgs = this.messages.get(sid) ?? []
    msgs.push({ info: msg, parts: [] })
    this.messages.set(sid, msgs)
    return msg
  }

  async savePart(part: Message.Part) {
    const msgs = this.messages.get(part.sessionID) ?? []
    const msg = msgs.find((m) => m.info.id === part.messageID)
    if (msg) {
      const idx = msg.parts.findIndex((p: Message.Part) => p.id === part.id)
      if (idx >= 0) msg.parts[idx] = part
      else msg.parts.push(part)
    }
    return part
  }

  async updateMessage(msg: Message.Assistant): Promise<void> {
    const msgs = this.messages.get(msg.sessionID) ?? []
    const idx = msgs.findIndex((m) => m.info.id === msg.id)
    if (idx >= 0) msgs[idx] = { ...msgs[idx], info: msg }
  }

  async deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void> {
    const msgs = this.messages.get(ref.sessionID) ?? []
    const msg = msgs.find((m) => m.info.id === ref.messageID)
    if (msg) msg.parts = msg.parts.filter((p: Message.Part) => p.id !== ref.partID)
  }

  async dispose(): Promise<void> {
    this.messages.clear()
  }
}

export class NoopCheckpointer implements Checkpointer {
  async loadHistory(): Promise<Message.WithParts[]> {
    return []
  }
  async write(): Promise<void> {}
  async saveMessage(msg: Message.Assistant | Message.User) {
    return msg
  }
  async savePart(part: Message.Part) {
    return part
  }
  async updateMessage(): Promise<void> {}
  async deletePart(): Promise<void> {}
  async dispose(): Promise<void> {}
}
