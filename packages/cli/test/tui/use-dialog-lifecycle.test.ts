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
})
