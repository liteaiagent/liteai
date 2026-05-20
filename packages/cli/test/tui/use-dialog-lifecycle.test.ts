import { beforeEach, describe, expect, it, mock } from "bun:test"
import { useDialogLifecycle } from "../../src/tui/primitives/use-dialog-lifecycle"

// ---- Mocks ----
// We capture the arguments passed to the keybinding hooks so we can assert
// on them and invoke handlers in tests.

let lastContextRegistration: { name: string; isActive: boolean } | null = null
let lastKeybindingsCall: { handlers: Record<string, () => void>; options: Record<string, unknown> } | null = null

mock.module("../../src/tui/keybindings/keybinding-context", () => ({
  useRegisterKeybindingContext: (name: string, isActive: boolean) => {
    lastContextRegistration = { name, isActive }
  },
}))

mock.module("../../src/tui/keybindings/use-keybinding", () => ({
  useKeybindings: (handlers: Record<string, () => void>, options: Record<string, unknown>) => {
    lastKeybindingsCall = { handlers, options }
  },
}))

describe("useDialogLifecycle", () => {
  beforeEach(() => {
    lastContextRegistration = null
    lastKeybindingsCall = null
  })

  it("registers keybinding context on mount", () => {
    const onClose = mock()
    useDialogLifecycle({ contextName: "Select", onClose })

    expect(lastContextRegistration).toEqual({ name: "Select", isActive: true })
  })

  it("passes isActive=false to context and keybindings", () => {
    const onClose = mock()
    useDialogLifecycle({ contextName: "Select", onClose, isActive: false })

    expect(lastContextRegistration).toEqual({ name: "Select", isActive: false })
    expect(lastKeybindingsCall?.options).toMatchObject({ isActive: false, context: "Select" })
  })

  it("calls onClose when select:cancel is triggered", () => {
    const onClose = mock()
    useDialogLifecycle({ contextName: "Select", onClose })

    expect(lastKeybindingsCall).not.toBeNull()
    const cancelHandler = lastKeybindingsCall?.handlers["select:cancel"]
    expect(cancelHandler).toBeDefined()

    cancelHandler?.()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("blocks close when preventCloseOn returns true", () => {
    const onClose = mock()
    const preventCloseOn = mock(() => true)
    useDialogLifecycle({ contextName: "Select", onClose, preventCloseOn })

    lastKeybindingsCall?.handlers["select:cancel"]()

    expect(preventCloseOn).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it("allows close when preventCloseOn returns false", () => {
    const onClose = mock()
    const preventCloseOn = mock(() => false)
    useDialogLifecycle({ contextName: "Select", onClose, preventCloseOn })

    lastKeybindingsCall?.handlers["select:cancel"]()

    expect(preventCloseOn).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("uses contextName as the keybinding context", () => {
    const onClose = mock()
    useDialogLifecycle({ contextName: "Select", onClose })

    expect(lastKeybindingsCall?.options).toMatchObject({ context: "Select" })
  })

  it("works with custom context names (DiffDialog)", () => {
    const onClose = mock()
    useDialogLifecycle({ contextName: "DiffDialog", onClose })

    expect(lastContextRegistration).toEqual({ name: "DiffDialog", isActive: true })
    expect(lastKeybindingsCall?.options).toMatchObject({ context: "DiffDialog" })
  })

  it("works with Settings context", () => {
    const onClose = mock()
    useDialogLifecycle({ contextName: "Settings", onClose })

    expect(lastContextRegistration).toEqual({ name: "Settings", isActive: true })
    expect(lastKeybindingsCall?.options).toMatchObject({ context: "Settings" })
  })

  it("handles rapid open/close cycles without stale handler leak", () => {
    const onClose1 = mock()
    const onClose2 = mock()

    // First lifecycle
    useDialogLifecycle({ contextName: "Select", onClose: onClose1 })
    const firstHandler = lastKeybindingsCall?.handlers["select:cancel"]

    // Second lifecycle (simulating re-open with different handler)
    useDialogLifecycle({ contextName: "Select", onClose: onClose2 })
    const secondHandler = lastKeybindingsCall?.handlers["select:cancel"]

    // Only the second handler should be registered now
    secondHandler?.()
    expect(onClose2).toHaveBeenCalledTimes(1)
    // First handler ref is stale — it still works if called, but the important
    // thing is useKeybindings received the new handler
    expect(firstHandler).not.toBe(secondHandler)
  })

  it("toggles isActive from true to false", () => {
    const onClose = mock()

    // Active
    useDialogLifecycle({ contextName: "Select", onClose, isActive: true })
    expect(lastContextRegistration).toEqual({ name: "Select", isActive: true })
    expect(lastKeybindingsCall?.options).toMatchObject({ isActive: true })

    // Deactivated
    useDialogLifecycle({ contextName: "Select", onClose, isActive: false })
    expect(lastContextRegistration).toEqual({ name: "Select", isActive: false })
    expect(lastKeybindingsCall?.options).toMatchObject({ isActive: false })
  })

  it("defaults isActive to true when not specified", () => {
    const onClose = mock()
    useDialogLifecycle({ contextName: "Select", onClose })

    expect(lastContextRegistration?.isActive).toBe(true)
    expect(lastKeybindingsCall?.options).toMatchObject({ isActive: true })
  })

  it("preventCloseOn receives no arguments", () => {
    const onClose = mock()
    const preventCloseOn = mock(() => false)
    useDialogLifecycle({ contextName: "Select", onClose, preventCloseOn })

    lastKeybindingsCall?.handlers["select:cancel"]()

    // Verify preventCloseOn was called with no arguments
    expect(preventCloseOn).toHaveBeenCalledWith()
  })
})
