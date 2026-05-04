import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Session } from "../../../src/session"
import type { PersistenceOp } from "../../../src/session/engine/loop/checkpointer"
import { MemoryCheckpointer, NoopCheckpointer, SqliteCheckpointer } from "../../../src/session/engine/loop/checkpointer"
import { Message } from "../../../src/session/message"

describe("Checkpointer", () => {
  describe("MemoryCheckpointer", () => {
    test("saveMessage + loadHistory — message round-trips", async () => {
      const cp = new MemoryCheckpointer()
      const msg = { id: "m1", sessionID: "s1", role: "user", content: "hello" } as unknown as Message.Info
      await cp.saveMessage(msg)

      const history = await cp.loadHistory("s1")
      expect(history).toHaveLength(1)
      expect(history[0].info).toEqual(msg)
      expect(history[0].parts).toEqual([])
    })

    test("savePart — part attaches to correct message", async () => {
      const cp = new MemoryCheckpointer()
      const msg = { id: "m1", sessionID: "s1", role: "assistant" } as unknown as Message.Info
      await cp.saveMessage(msg)

      const part = { id: "p1", messageID: "m1", sessionID: "s1", type: "text", text: "hi" } as unknown as Message.Part
      await cp.savePart(part)

      const history = await cp.loadHistory("s1")
      expect(history[0].parts).toHaveLength(1)
      expect(history[0].parts[0]).toEqual(part)
    })

    test("updateMessage — metadata updates reflected in loadHistory", async () => {
      const cp = new MemoryCheckpointer()
      const msg = { id: "m1", sessionID: "s1", role: "assistant" } as unknown as Message.Info
      await cp.saveMessage(msg)

      const updated = { ...msg, state: "completed" } as unknown as Message.Info
      await cp.updateMessage(updated)

      const history = await cp.loadHistory("s1")
      expect(history[0].info.state).toBe("completed")
    })

    test("deletePart — part removed from message", async () => {
      const cp = new MemoryCheckpointer()
      const msg = { id: "m1", sessionID: "s1", role: "assistant" } as unknown as Message.Info
      await cp.saveMessage(msg)

      const part = { id: "p1", messageID: "m1", sessionID: "s1", type: "text", text: "hi" } as unknown as Message.Part
      await cp.savePart(part)

      await cp.deletePart({ sessionID: "s1", messageID: "m1", partID: "p1" })

      const history = await cp.loadHistory("s1")
      expect(history[0].parts).toHaveLength(0)
    })

    test("write(ops) — batch ops applied correctly", async () => {
      const cp = new MemoryCheckpointer()
      const msg = { id: "m1", sessionID: "s1", role: "assistant" } as unknown as Message.Info
      await cp.saveMessage(msg)

      const part = { id: "p1", messageID: "m1", sessionID: "s1", type: "text", text: "" } as unknown as Message.Part
      await cp.savePart(part)

      const ops: PersistenceOp[] = [
        { type: "upsert-message", message: { ...msg, state: "streaming" } },
        { type: "delta-part", sessionID: "s1", messageID: "m1", partID: "p1", field: "text", delta: "hello " },
        { type: "delta-part", sessionID: "s1", messageID: "m1", partID: "p1", field: "text", delta: "world" },
      ]

      await cp.write(ops)

      const history = await cp.loadHistory("s1")
      expect(history[0].info.state).toBe("streaming")
      expect((history[0].parts[0] as unknown as { text: string }).text).toBe("hello world")
    })

    test("dispose — clears all data", async () => {
      const cp = new MemoryCheckpointer()
      const msg = { id: "m1", sessionID: "s1", role: "user" } as unknown as Message.Info
      await cp.saveMessage(msg)
      await cp.dispose()

      const history = await cp.loadHistory("s1")
      expect(history).toHaveLength(0)
    })
  })

  describe("NoopCheckpointer", () => {
    test("methods resolve without error and loadHistory returns []", async () => {
      const cp = new NoopCheckpointer()
      const msg = { id: "m1" } as unknown as Message.Info
      const part = { id: "p1" } as unknown as Message.Part

      await expect(cp.saveMessage(msg)).resolves.toBe(msg)
      await expect(cp.savePart(part)).resolves.toBe(part)
      await expect(cp.updateMessage(msg)).resolves.toBeUndefined()
      await expect(cp.write([])).resolves.toBeUndefined()
      await expect(cp.deletePart({ sessionID: "s", messageID: "m", partID: "p" })).resolves.toBeUndefined()
      await expect(cp.loadHistory("s")).resolves.toEqual([])
      await expect(cp.dispose()).resolves.toBeUndefined()
    })
  })

  describe("SqliteCheckpointer", () => {
    afterEach(() => {
      // no mock.module, use restoreAllMocks to clean up spyOn
      import("bun:test").then((m) => m.restoreAllMocks?.()) // or just wait
    })

    test("delegates to Session and Message correctly", async () => {
      const updateMessageSpy = spyOn(Session, "updateMessage").mockImplementation(
        async (m) => m as unknown as Message.Info,
      )
      const updatePartSpy = spyOn(Session, "updatePart").mockImplementation(async (p) => p as unknown as Message.Part)
      const updatePartDeltaSpy = spyOn(Session, "updatePartDelta").mockImplementation(async () => {})
      const removePartSpy = spyOn(Session, "removePart").mockImplementation(async () => {})

      const streamSpy = spyOn(Message, "stream").mockReturnValue([] as unknown as ReturnType<typeof Message.stream>)
      const filterSpy = spyOn(Message, "filterCompacted").mockReturnValue(
        [] as unknown as ReturnType<typeof Message.filterCompacted>,
      )

      const cp = new SqliteCheckpointer()

      await cp.loadHistory("s1")
      expect(streamSpy).toHaveBeenCalledWith("s1")
      expect(filterSpy).toHaveBeenCalled()

      const msg = { id: "m1" } as unknown as Message.Info
      await cp.saveMessage(msg)
      expect(updateMessageSpy).toHaveBeenCalledWith(msg)

      const part = { id: "p1" } as unknown as Message.Part
      await cp.savePart(part)
      expect(updatePartSpy).toHaveBeenCalledWith(part)

      await cp.updateMessage(msg)
      expect(updateMessageSpy).toHaveBeenCalledWith(msg)

      await cp.deletePart({ sessionID: "s", messageID: "m", partID: "p" })
      expect(removePartSpy).toHaveBeenCalledWith({ sessionID: "s", messageID: "m", partID: "p" })

      const ops: PersistenceOp[] = [
        { type: "upsert-part", part: part },
        { type: "delta-part", sessionID: "s", messageID: "m", partID: "p", field: "text", delta: "d" },
        { type: "upsert-message", message: msg },
      ]
      await cp.write(ops)

      expect(updatePartSpy).toHaveBeenCalledWith(part)
      expect(updatePartDeltaSpy).toHaveBeenCalledWith(
        ops[1] as unknown as Parameters<typeof Session.updatePartDelta>[0],
      )
      expect(updateMessageSpy).toHaveBeenCalledWith(msg)

      updateMessageSpy.mockRestore()
      updatePartSpy.mockRestore()
      updatePartDeltaSpy.mockRestore()
      removePartSpy.mockRestore()
      streamSpy.mockRestore()
      filterSpy.mockRestore()
    })
  })
})
