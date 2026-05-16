import { useEffect, useReducer, useRef } from "react"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"
import type { SelectItem, SelectListOptions, SelectListState } from "./types"

interface SelectionListReducerState<T> {
  activeIndex: number
  initialIndex: number
  pendingHighlight: boolean
  pendingSelect: boolean
  items: SelectItem<T>[]
  wrapAround: boolean
}

type SelectionListAction<T> =
  | { type: "SET_ACTIVE_INDEX"; payload: { index: number } }
  | { type: "MOVE_UP" }
  | { type: "MOVE_DOWN" }
  | { type: "SELECT_CURRENT" }
  | {
      type: "INITIALIZE"
      payload: {
        initialIndex: number
        items: SelectItem<T>[]
        wrapAround: boolean
      }
    }
  | { type: "CLEAR_PENDING_FLAGS" }

const NUMBER_INPUT_TIMEOUT_MS = 1000

/**
 * Helper function to find the next enabled index in a given direction, supporting wrapping.
 */
function findNextValidIndex<T>(
  currentIndex: number,
  direction: "up" | "down",
  items: SelectItem<T>[],
  wrapAround = true,
): number {
  const len = items.length
  if (len === 0) return currentIndex

  let nextIndex = currentIndex
  const step = direction === "down" ? 1 : -1

  for (let i = 0; i < len; i++) {
    const candidateIndex = nextIndex + step

    if (wrapAround) {
      // Calculate the next index, wrapping around if necessary.
      // We add `len` before the modulo to ensure a positive result in JS for negative steps.
      nextIndex = (candidateIndex + len) % len
    } else {
      if (candidateIndex < 0 || candidateIndex >= len) {
        // Out of bounds and wrapping is disabled
        return currentIndex
      }
      nextIndex = candidateIndex
    }

    if (!items[nextIndex]?.disabled) {
      return nextIndex
    }

    if (!wrapAround) {
      // If the item is disabled and we're not wrapping, we continue searching
      // in the same direction, but we must stop if we hit the bounds.
      if ((direction === "down" && nextIndex === len - 1) || (direction === "up" && nextIndex === 0)) {
        return currentIndex
      }
    }
  }

  // If all items are disabled, return the original index
  return currentIndex
}

function computeInitialIndex<T>(initialIndex: number, items: SelectItem<T>[], initialKey?: string): number {
  if (items.length === 0) {
    return 0
  }

  if (initialKey !== undefined) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].key === initialKey && !items[i].disabled) {
        return i
      }
    }
  }

  let targetIndex = initialIndex

  if (targetIndex < 0 || targetIndex >= items.length) {
    targetIndex = 0
  }

  if (items[targetIndex]?.disabled) {
    const nextValid = findNextValidIndex(targetIndex, "down", items, true)
    targetIndex = nextValid
  }

  return targetIndex
}

function selectionListReducer<T>(
  state: SelectionListReducerState<T>,
  action: SelectionListAction<T>,
): SelectionListReducerState<T> {
  switch (action.type) {
    case "SET_ACTIVE_INDEX": {
      const { index } = action.payload
      const { items } = state

      // Only update if index actually changed and is valid
      if (index === state.activeIndex) {
        return state
      }

      if (index >= 0 && index < items.length) {
        return { ...state, activeIndex: index, pendingHighlight: true }
      }
      return state
    }

    case "MOVE_UP": {
      const { items, wrapAround } = state
      const newIndex = findNextValidIndex(state.activeIndex, "up", items, wrapAround)
      if (newIndex !== state.activeIndex) {
        return { ...state, activeIndex: newIndex, pendingHighlight: true }
      }
      return state
    }

    case "MOVE_DOWN": {
      const { items, wrapAround } = state
      const newIndex = findNextValidIndex(state.activeIndex, "down", items, wrapAround)
      if (newIndex !== state.activeIndex) {
        return { ...state, activeIndex: newIndex, pendingHighlight: true }
      }
      return state
    }

    case "SELECT_CURRENT": {
      return { ...state, pendingSelect: true }
    }

    case "INITIALIZE": {
      const { initialIndex, items, wrapAround } = action.payload
      const activeKey = initialIndex === state.initialIndex ? state.items[state.activeIndex]?.key : undefined

      const targetIndex = computeInitialIndex(initialIndex, items, activeKey)

      return {
        ...state,
        items,
        initialIndex,
        activeIndex: targetIndex,
        pendingHighlight: false,
        wrapAround,
      }
    }

    case "CLEAR_PENDING_FLAGS": {
      return {
        ...state,
        pendingHighlight: false,
        pendingSelect: false,
      }
    }

    default: {
      return state
    }
  }
}

function areItemsEqual<T>(a: SelectItem<T>[], b: SelectItem<T>[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].disabled !== b[i].disabled) {
      return false
    }
  }

  return true
}

/**
 * A headless hook that provides keyboard navigation and selection logic
 * for list-based selection components like radio buttons and menus.
 *
 * Features:
 * - Keyboard navigation with j/k and arrow keys
 * - Selection with Enter key
 * - Numeric quick selection (when showNumbers is true)
 * - Handles disabled items (skips them during navigation)
 * - Wrapping navigation (last to first, first to last)
 */
export function useSelectList<T>({
  items,
  initialIndex = 0,
  onSelect,
  onHighlight,
  isFocused = true,
  showNumbers = false,
  wrapAround = true,
}: SelectListOptions<T>): SelectListState<T> {
  // Register the Select context if we are focused
  useRegisterKeybindingContext("Select", isFocused)

  const [state, dispatch] = useReducer(selectionListReducer<T>, {
    activeIndex: computeInitialIndex(initialIndex, items),
    initialIndex,
    pendingHighlight: false,
    pendingSelect: false,
    items: items,
    wrapAround,
  })

  const numberInputRef = useRef("")
  const numberInputTimer = useRef<Timer | null>(null)

  const prevItemsRef = useRef(items)
  const prevInitialIndexRef = useRef(initialIndex)
  const prevWrapAroundRef = useRef(wrapAround)

  // Initialize/synchronize state when initialIndex or items change.
  // Refs track previous values for structural equality (areItemsEqual);
  // the dep array ensures the effect only runs when inputs change referentially.
  useEffect(() => {
    const itemsChanged = !areItemsEqual(prevItemsRef.current, items)
    const initialIndexChanged = prevInitialIndexRef.current !== initialIndex
    const wrapAroundChanged = prevWrapAroundRef.current !== wrapAround

    if (itemsChanged || initialIndexChanged || wrapAroundChanged) {
      dispatch({
        type: "INITIALIZE",
        payload: { initialIndex, items, wrapAround },
      })
      prevItemsRef.current = items
      prevInitialIndexRef.current = initialIndex
      prevWrapAroundRef.current = wrapAround
    }
  }, [items, initialIndex, wrapAround])

  // Handle side effects based on state changes
  useEffect(() => {
    let needsClear = false

    if (state.pendingHighlight && items[state.activeIndex]) {
      onHighlight?.(items[state.activeIndex].value)
      needsClear = true
    }

    if (state.pendingSelect && items[state.activeIndex]) {
      const currentItem = items[state.activeIndex]
      if (currentItem && !currentItem.disabled) {
        onSelect(currentItem.value)
      }
      needsClear = true
    }

    if (needsClear) {
      dispatch({ type: "CLEAR_PENDING_FLAGS" })
    }
  }, [state.pendingHighlight, state.pendingSelect, state.activeIndex, items, onHighlight, onSelect])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (numberInputTimer.current) {
        clearTimeout(numberInputTimer.current)
      }
    }
  }, [])

  const itemsLength = items.length

  const clearNumberBuffer = () => {
    if (numberInputTimer.current) {
      clearTimeout(numberInputTimer.current)
    }
    numberInputRef.current = ""
  }

  const handleNavigationAction = (action: "MOVE_UP" | "MOVE_DOWN" | "SELECT_CURRENT") => {
    clearNumberBuffer()
    dispatch({ type: action })
  }

  const handleDigit = (digit: string) => {
    if (numberInputTimer.current) {
      clearTimeout(numberInputTimer.current)
    }

    const newNumberInput = numberInputRef.current + digit
    numberInputRef.current = newNumberInput

    const targetIndex = Number.parseInt(newNumberInput, 10) - 1

    // Single '0' is invalid (1-indexed)
    if (newNumberInput === "0") {
      numberInputTimer.current = setTimeout(() => {
        numberInputRef.current = ""
      }, NUMBER_INPUT_TIMEOUT_MS)
      return
    }

    if (targetIndex >= 0 && targetIndex < itemsLength) {
      dispatch({
        type: "SET_ACTIVE_INDEX",
        payload: { index: targetIndex },
      })

      // If the number can't be a prefix for another valid number, select immediately
      const potentialNextNumber = Number.parseInt(`${newNumberInput}0`, 10)
      if (potentialNextNumber > itemsLength) {
        dispatch({ type: "SELECT_CURRENT" })
        numberInputRef.current = ""
      } else {
        // Otherwise wait for more input or timeout
        numberInputTimer.current = setTimeout(() => {
          dispatch({ type: "SELECT_CURRENT" })
          numberInputRef.current = ""
        }, NUMBER_INPUT_TIMEOUT_MS)
      }
    } else {
      // Number is out of bounds
      numberInputRef.current = ""
    }
  }

  // Dynamic digit handlers based on showNumbers
  const digitHandlers: Record<string, () => void> = {}
  if (showNumbers) {
    for (let i = 0; i <= 9; i++) {
      digitHandlers[`select:digit${i}`] = () => handleDigit(i.toString())
    }
  }

  useKeybindings(
    {
      "select:previous": () => handleNavigationAction("MOVE_UP"),
      "select:next": () => handleNavigationAction("MOVE_DOWN"),
      // Note: pageUp, pageDown, home, end don't have direct equivalents in the old hook's move function unless we expose them.
      // Let's map page up/down to 10 items for now, or just to top/bottom.
      // Since we removed windowing from the hook, page up/down should probably just jump by 10 for now.
      "select:pageUp": () => {
        clearNumberBuffer()
        const nextIndex = Math.max(0, state.activeIndex - 10)
        dispatch({ type: "SET_ACTIVE_INDEX", payload: { index: nextIndex } })
      },
      "select:pageDown": () => {
        clearNumberBuffer()
        const nextIndex = Math.min(items.length - 1, state.activeIndex + 10)
        dispatch({ type: "SET_ACTIVE_INDEX", payload: { index: nextIndex } })
      },
      "select:home": () => {
        clearNumberBuffer()
        dispatch({ type: "SET_ACTIVE_INDEX", payload: { index: 0 } })
      },
      "select:end": () => {
        clearNumberBuffer()
        dispatch({ type: "SET_ACTIVE_INDEX", payload: { index: items.length - 1 } })
      },
      "select:accept": () => handleNavigationAction("SELECT_CURRENT"),
      ...digitHandlers,
    },
    { context: "Select", isActive: isFocused && itemsLength > 0 },
  )

  return {
    activeIndex: state.activeIndex,
    setActiveIndex: (index: number) => {
      clearNumberBuffer()
      dispatch({ type: "SET_ACTIVE_INDEX", payload: { index } })
    },
    activeItem: items[state.activeIndex],
  }
}
