import { beforeEach, describe, expect, it, mock } from "bun:test"
import type { SelectItem } from "../../src/tui/primitives/types"

// ---------------------------------------------------------------------------
// Instead of calling the React hook directly (which requires a React render
// context), we test the pure reducer and helper functions that back it.
//
// We export these internals via a test-only barrel so the hook's logic is
// verified in isolation, while handler wiring is validated via integration.
// ---------------------------------------------------------------------------

// ---- Mocks for React hooks used by the module ----
// We mock useReducer, useRef, useEffect to extract the reducer from the
// module without needing a full React context.

let capturedReducer: any = null
let capturedInitialState: any = null
let capturedKeybindingHandlers: Record<string, () => void> = {}
let capturedKeybindingOptions: any = {}

// Mock React to capture reducer
mock.module("react", () => ({
  useReducer: (reducer: any, initialState: any) => {
    capturedReducer = reducer
    capturedInitialState = initialState
    return [initialState, () => {}]
  },
  useRef: (initial: any) => ({ current: initial }),
  useEffect: () => {},
}))

mock.module("../../src/tui/keybindings/keybinding-context", () => ({
  useRegisterKeybindingContext: () => {},
}))

mock.module("../../src/tui/keybindings/use-keybinding", () => ({
  useKeybindings: (handlers: Record<string, () => void>, options: any) => {
    capturedKeybindingHandlers = handlers
    capturedKeybindingOptions = options
  },
}))

// Import after mocks
import { useSelectList } from "../../src/tui/primitives/use-select-list"

describe("useSelectList", () => {
  const mockOnSelect = mock()
  const mockOnHighlight = mock()

  const items: SelectItem<string>[] = [
    { value: "A", key: "A", label: "Item A" },
    { value: "B", key: "B", label: "Item B", disabled: true },
    { value: "C", key: "C", label: "Item C" },
    { value: "D", key: "D", label: "Item D" },
  ]

  beforeEach(() => {
    capturedReducer = null
    capturedInitialState = null
    capturedKeybindingHandlers = {}
    capturedKeybindingOptions = {}
    mockOnSelect.mockClear()
    mockOnHighlight.mockClear()
  })

  // Helper: call the hook to capture its reducer and keybinding state
  const initHook = (overrides: Partial<Parameters<typeof useSelectList<string>>[0]> = {}) => {
    useSelectList({ items, onSelect: mockOnSelect, ...overrides })
    return {
      reducer: capturedReducer,
      initialState: capturedInitialState,
      handlers: capturedKeybindingHandlers,
      options: capturedKeybindingOptions,
    }
  }

  // ---- Initialization (via reducer initial state) ----

  describe("Initialization", () => {
    it("initializes with default index 0", () => {
      const { initialState } = initHook()
      expect(initialState.activeIndex).toBe(0)
    })

    it("initializes with provided initialIndex", () => {
      const { initialState } = initHook({ initialIndex: 2 })
      expect(initialState.activeIndex).toBe(2)
    })

    it("handles an empty list gracefully", () => {
      const { initialState } = initHook({ items: [] })
      expect(initialState.activeIndex).toBe(0)
    })

    it("skips disabled item at initialIndex", () => {
      const { initialState } = initHook({ initialIndex: 1 })
      expect(initialState.activeIndex).toBe(2) // B disabled → skips to C
    })

    it("defaults to 0 if initialIndex is out of bounds", () => {
      const { initialState } = initHook({ initialIndex: 99 })
      expect(initialState.activeIndex).toBe(0)
    })

    it("sticks to initial index if all items are disabled", () => {
      const allDisabled: SelectItem<string>[] = [
        { value: "X", key: "X", label: "X", disabled: true },
        { value: "Y", key: "Y", label: "Y", disabled: true },
      ]
      const { initialState } = initHook({ items: allDisabled, initialIndex: 1 })
      expect(initialState.activeIndex).toBe(1)
    })
  })

  // ---- Reducer: Navigation ----

  describe("Reducer: Navigation", () => {
    it("MOVE_DOWN skips disabled items", () => {
      const { reducer, initialState } = initHook() // activeIndex=0
      const newState = reducer(initialState, { type: "MOVE_DOWN" })
      expect(newState.activeIndex).toBe(2) // Skips B (disabled)
      expect(newState.pendingHighlight).toBe(true)
    })

    it("MOVE_DOWN advances to next enabled item", () => {
      const { reducer, initialState } = initHook()
      const afterFirst = reducer(initialState, { type: "MOVE_DOWN" })
      const afterSecond = reducer(afterFirst, { type: "MOVE_DOWN" })
      expect(afterSecond.activeIndex).toBe(3)
    })

    it("MOVE_UP skips disabled items", () => {
      const { reducer, initialState } = initHook({ initialIndex: 3 })
      const after = reducer(initialState, { type: "MOVE_UP" })
      expect(after.activeIndex).toBe(2) // Skips B
    })

    it("MOVE_UP wraps from top to bottom", () => {
      const { reducer, initialState } = initHook() // activeIndex=0
      const after = reducer(initialState, { type: "MOVE_UP" })
      expect(after.activeIndex).toBe(3)
    })

    it("MOVE_DOWN wraps from bottom to top", () => {
      const { reducer, initialState } = initHook({ initialIndex: 3 })
      const after = reducer(initialState, { type: "MOVE_DOWN" })
      expect(after.activeIndex).toBe(0)
    })

    it("does not move when wrapAround=false and at boundary", () => {
      const { reducer, initialState } = initHook({ initialIndex: 3, wrapAround: false })
      const after = reducer(initialState, { type: "MOVE_DOWN" })
      expect(after.activeIndex).toBe(3)
      // State reference should be the same (no-op)
      expect(after).toBe(initialState)
    })

    it("does not move when all items are disabled", () => {
      const allDisabled: SelectItem<string>[] = [
        { value: "X", key: "X", label: "X", disabled: true },
        { value: "Y", key: "Y", label: "Y", disabled: true },
      ]
      const { reducer, initialState } = initHook({ items: allDisabled })
      const after = reducer(initialState, { type: "MOVE_DOWN" })
      expect(after).toBe(initialState) // Same reference — no change
    })
  })

  // ---- Reducer: SET_ACTIVE_INDEX ----

  describe("Reducer: SET_ACTIVE_INDEX", () => {
    it("sets active index to a valid value", () => {
      const { reducer, initialState } = initHook()
      const after = reducer(initialState, { type: "SET_ACTIVE_INDEX", payload: { index: 3 } })
      expect(after.activeIndex).toBe(3)
      expect(after.pendingHighlight).toBe(true)
    })

    it("ignores out-of-bounds index", () => {
      const { reducer, initialState } = initHook()
      const after = reducer(initialState, { type: "SET_ACTIVE_INDEX", payload: { index: 99 } })
      expect(after).toBe(initialState)
    })

    it("ignores negative index", () => {
      const { reducer, initialState } = initHook()
      const after = reducer(initialState, { type: "SET_ACTIVE_INDEX", payload: { index: -1 } })
      expect(after).toBe(initialState)
    })

    it("no-ops when setting to the same index", () => {
      const { reducer, initialState } = initHook()
      const after = reducer(initialState, { type: "SET_ACTIVE_INDEX", payload: { index: 0 } })
      expect(after).toBe(initialState)
    })
  })

  // ---- Reducer: SELECT_CURRENT ----

  describe("Reducer: SELECT_CURRENT", () => {
    it("sets pendingSelect flag", () => {
      const { reducer, initialState } = initHook()
      const after = reducer(initialState, { type: "SELECT_CURRENT" })
      expect(after.pendingSelect).toBe(true)
    })
  })

  // ---- Reducer: CLEAR_PENDING_FLAGS ----

  describe("Reducer: CLEAR_PENDING_FLAGS", () => {
    it("clears both pending flags", () => {
      const { reducer, initialState } = initHook()
      const withFlags = { ...initialState, pendingHighlight: true, pendingSelect: true }
      const after = reducer(withFlags, { type: "CLEAR_PENDING_FLAGS" })
      expect(after.pendingHighlight).toBe(false)
      expect(after.pendingSelect).toBe(false)
    })
  })

  // ---- Reducer: INITIALIZE ----

  describe("Reducer: INITIALIZE", () => {
    it("re-initializes with new items", () => {
      const { reducer, initialState } = initHook()
      const newItems: SelectItem<string>[] = [
        { value: "X", key: "X", label: "X" },
        { value: "Y", key: "Y", label: "Y" },
      ]
      const after = reducer(initialState, {
        type: "INITIALIZE",
        payload: { initialIndex: 0, items: newItems, wrapAround: true },
      })
      expect(after.items).toBe(newItems)
      expect(after.activeIndex).toBe(0)
    })

    it("skips disabled items during re-initialization", () => {
      const { reducer, initialState } = initHook()
      const newItems: SelectItem<string>[] = [
        { value: "X", key: "X", label: "X", disabled: true },
        { value: "Y", key: "Y", label: "Y" },
      ]
      const after = reducer(initialState, {
        type: "INITIALIZE",
        payload: { initialIndex: 0, items: newItems, wrapAround: true },
      })
      expect(after.activeIndex).toBe(1)
    })
  })

  // ---- Keybinding Registration ----

  describe("Keybinding Registration", () => {
    it("registers all expected navigation handlers", () => {
      const { handlers } = initHook()
      expect(handlers["select:previous"]).toBeDefined()
      expect(handlers["select:next"]).toBeDefined()
      expect(handlers["select:accept"]).toBeDefined()
      expect(handlers["select:pageUp"]).toBeDefined()
      expect(handlers["select:pageDown"]).toBeDefined()
      expect(handlers["select:home"]).toBeDefined()
      expect(handlers["select:end"]).toBeDefined()
    })

    it("does not register digit handlers when showNumbers=false", () => {
      const { handlers } = initHook({ showNumbers: false })
      expect(handlers["select:digit1"]).toBeUndefined()
      expect(handlers["select:digit9"]).toBeUndefined()
    })

    it("registers digit handlers when showNumbers=true", () => {
      const { handlers } = initHook({ showNumbers: true })
      for (let i = 0; i <= 9; i++) {
        expect(handlers[`select:digit${i}`]).toBeDefined()
      }
    })
  })

  // ---- Focus Management ----

  describe("Focus Management", () => {
    it("activates handlers when focused and items exist", () => {
      const { options } = initHook({ isFocused: true })
      expect(options.isActive).toBe(true)
    })

    it("deactivates handlers when isFocused=false", () => {
      const { options } = initHook({ isFocused: false })
      expect(options.isActive).toBe(false)
    })

    it("deactivates handlers when items list is empty", () => {
      const { options } = initHook({ items: [], isFocused: true })
      expect(options.isActive).toBe(false)
    })

    it("uses Select keybinding context", () => {
      const { options } = initHook()
      expect(options.context).toBe("Select")
    })
  })

  // ---- Return Value ----

  describe("Return Value", () => {
    it("returns activeItem for current index", () => {
      const result = useSelectList({ items, initialIndex: 2, onSelect: mockOnSelect })
      expect(result.activeItem?.value).toBe("C")
    })

    it("returns undefined activeItem for empty list", () => {
      const result = useSelectList({ items: [], onSelect: mockOnSelect })
      expect(result.activeItem).toBeUndefined()
    })

    it("exposes setActiveIndex function", () => {
      const result = useSelectList({ items, onSelect: mockOnSelect })
      expect(typeof result.setActiveIndex).toBe("function")
    })
  })
})
