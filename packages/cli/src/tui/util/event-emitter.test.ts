import { describe, expect, it, mock } from "bun:test"
import { createEventEmitter } from "./event-emitter"

describe("event-emitter util", () => {
  it("should subscribe and emit events", () => {
    const emitter = createEventEmitter<{ foo: string; bar: number }>()
    const handler = mock((_val: string) => {})

    emitter.on("foo", handler)
    emitter.emit("foo", "hello")

    expect(handler).toHaveBeenCalledWith("hello")
  })

  it("should unsubscribe via returned function", () => {
    const emitter = createEventEmitter<{ foo: string }>()
    const handler = mock((_val: string) => {})

    const off = emitter.on("foo", handler)
    off()

    emitter.emit("foo", "hello")
    expect(handler).not.toHaveBeenCalled()
  })

  it("should unsubscribe via off method", () => {
    const emitter = createEventEmitter<{ foo: string }>()
    const handler = mock((_val: string) => {})

    emitter.on("foo", handler)
    emitter.off("foo", handler)

    emitter.emit("foo", "hello")
    expect(handler).not.toHaveBeenCalled()
  })

  it("should handle multiple subscribers", () => {
    const emitter = createEventEmitter<{ foo: string }>()
    const h1 = mock((_v: string) => {})
    const h2 = mock((_v: string) => {})

    emitter.on("foo", h1)
    emitter.on("foo", h2)

    emitter.emit("foo", "test")

    expect(h1).toHaveBeenCalledWith("test")
    expect(h2).toHaveBeenCalledWith("test")
  })
})
