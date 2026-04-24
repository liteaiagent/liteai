import {
  type RefObject,
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import type { ScrollBoxHandle, VirtualScrollPorts } from '../types.js'

const DEFAULT_ESTIMATE = 3
const OVERSCAN_ROWS = 80
const COLD_START_COUNT = 30
const SCROLL_QUANTUM = OVERSCAN_ROWS >> 1
const PESSIMISTIC_HEIGHT = 1
const MAX_MOUNTED_ITEMS = 300
const SLIDE_STEP = 25

const NOOP_UNSUB = () => {}

export interface VirtualScrollResult {
  range: readonly [number, number]
  topSpacer: number
  bottomSpacer: number
  measureRef: (key: string) => (el: HTMLElement | null) => void
  spacerRef: RefObject<HTMLElement | null>
  offsets: ArrayLike<number>
  getItemTop: (index: number) => number
  getItemElement: (index: number) => HTMLElement | null
  getItemHeight: (index: number) => number | undefined
  scrollToIndex: (i: number) => void
}

/**
 * Platform-agnostic virtualization logic.
 * Ported from Ink version with dependency injection for measurements.
 */
export function useVirtualScroll(
  scrollRef: RefObject<ScrollBoxHandle | null>,
  itemKeys: readonly string[],
  columns: number,
  ports: VirtualScrollPorts,
): VirtualScrollResult {
  const heightCache = useRef(new Map<string, number>())
  const offsetVersionRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  const offsetsRef = useRef<{ arr: Float64Array; version: number; n: number }>({
    arr: new Float64Array(0),
    version: -1,
    n: -1,
  })
  const itemRefs = useRef(new Map<string, HTMLElement>())
  const refCache = useRef(new Map<string, (el: HTMLElement | null) => void>())

  const prevColumns = useRef(columns)
  const skipMeasurementRef = useRef(false)
  const prevRangeRef = useRef<readonly [number, number] | null>(null)
  const freezeRendersRef = useRef(0)

  if (prevColumns.current !== columns) {
    const ratio = prevColumns.current / columns
    prevColumns.current = columns
    for (const [k, h] of heightCache.current) {
      heightCache.current.set(k, Math.max(1, Math.round(h * ratio)))
    }
    offsetVersionRef.current++
    skipMeasurementRef.current = true
    freezeRendersRef.current = 2
  }

  const frozenRange = freezeRendersRef.current > 0 ? prevRangeRef.current : null
  const listOriginRef = useRef(0)
  const spacerRef = useRef<HTMLElement | null>(null)

  const subscribe = useCallback(
    (listener: () => void) => scrollRef.current?.subscribe(listener) ?? NOOP_UNSUB,
    [scrollRef],
  )

  useSyncExternalStore(subscribe, () => {
    const s = scrollRef.current
    if (!s) return NaN
    const target = s.getScrollTop() + s.getPendingDelta()
    const bin = Math.floor(target / SCROLL_QUANTUM)
    return s.isSticky() ? ~bin : bin
  })

  const scrollTop = scrollRef.current?.getScrollTop() ?? -1
  const pendingDelta = scrollRef.current?.getPendingDelta() ?? 0
  const viewportH = scrollRef.current?.getViewportHeight() ?? 0
  const isSticky = scrollRef.current?.isSticky() ?? true

  useMemo(() => {
    const live = new Set(itemKeys)
    let dirty = false
    for (const k of heightCache.current.keys()) {
      if (!live.has(k)) {
        heightCache.current.delete(k)
        dirty = true
      }
    }
    for (const k of refCache.current.keys()) {
      if (!live.has(k)) refCache.current.delete(k)
    }
    if (dirty) offsetVersionRef.current++
  }, [itemKeys])

  const n = itemKeys.length
  if (offsetsRef.current.version !== offsetVersionRef.current || offsetsRef.current.n !== n) {
    const arr = offsetsRef.current.arr.length >= n + 1 ? offsetsRef.current.arr : new Float64Array(n + 1)
    arr[0] = 0
    for (let i = 0; i < n; i++) {
      const currentArr = arr[i] ?? 0
      const currentItemKey = itemKeys[i] ?? ''
      arr[i + 1] = currentArr + (heightCache.current.get(currentItemKey) ?? DEFAULT_ESTIMATE)
    }
    offsetsRef.current = { arr, version: offsetVersionRef.current, n }
  }
  const offsets = offsetsRef.current.arr
  const totalHeight = offsets[n] ?? 0

  let start: number
  let end: number

  if (frozenRange) {
    ;[start, end] = frozenRange
    start = Math.min(start, n)
    end = Math.min(end, n)
  } else if (viewportH === 0 || scrollTop < 0) {
    start = Math.max(0, n - COLD_START_COUNT)
    end = n
  } else {
    if (isSticky) {
      const budget = viewportH + OVERSCAN_ROWS
      start = n
      while (start > 0 && totalHeight - (offsets[start - 1] ?? 0) < budget) {
        start--
      }
      end = n
    } else {
      const listOrigin = listOriginRef.current
      const MAX_SPAN_ROWS = viewportH * 3
      const rawLo = Math.min(scrollTop, scrollTop + pendingDelta)
      const rawHi = Math.max(scrollTop, scrollTop + pendingDelta)
      const span = rawHi - rawLo
      const clampedLo = span > MAX_SPAN_ROWS ? (pendingDelta < 0 ? rawHi - MAX_SPAN_ROWS : rawLo) : rawLo
      const clampedHi = clampedLo + Math.min(span, MAX_SPAN_ROWS)
      const effLo = Math.max(0, clampedLo - listOrigin)
      const effHi = clampedHi - listOrigin
      const lo = effLo - OVERSCAN_ROWS

      let l = 0
      let r = n
      while (l < r) {
        const m = (l + r) >> 1
        if ((offsets[m + 1] ?? 0) <= lo) l = m + 1
        else r = m
      }
      start = l

      const p = prevRangeRef.current
      if (p && p[0] < start) {
        for (let i = p[0]; i < Math.min(start, p[1]); i++) {
          const k = itemKeys[i]
          if (!k) continue
          if (itemRefs.current.has(k) && !heightCache.current.has(k)) {
            start = i
            break
          }
        }
      }

      const needed = viewportH + 2 * OVERSCAN_ROWS
      const maxEnd = Math.min(n, start + MAX_MOUNTED_ITEMS)
      let coverage = 0
      end = start
      while (end < maxEnd && (coverage < needed || (offsets[end] ?? 0) < effHi + viewportH + OVERSCAN_ROWS)) {
        const key = itemKeys[end] ?? ''
        coverage += heightCache.current.get(key) ?? PESSIMISTIC_HEIGHT
        end++
      }
    }

    const needed = viewportH + 2 * OVERSCAN_ROWS
    const minStart = Math.max(0, end - MAX_MOUNTED_ITEMS)
    let coverage = 0
    for (let i = start; i < end; i++) {
      const key = itemKeys[i] ?? ''
      coverage += heightCache.current.get(key) ?? PESSIMISTIC_HEIGHT
    }
    while (start > minStart && coverage < needed) {
      start--
      const key = itemKeys[start] ?? ''
      coverage += heightCache.current.get(key) ?? PESSIMISTIC_HEIGHT
    }

    const prev = prevRangeRef.current
    const scrollVelocity = Math.abs(scrollTop - lastScrollTopRef.current) + Math.abs(pendingDelta)
    if (prev && scrollVelocity > viewportH * 2) {
      const [pS, pE] = prev
      if (start < pS - SLIDE_STEP) start = pS - SLIDE_STEP
      if (end > pE + SLIDE_STEP) end = pE + SLIDE_STEP
      if (start > end) end = Math.min(start + SLIDE_STEP, n)
    }
    lastScrollTopRef.current = scrollTop
  }

  if (freezeRendersRef.current > 0) {
    freezeRendersRef.current--
  } else {
    prevRangeRef.current = [start, end]
  }

  const dStart = useDeferredValue(start)
  const dEnd = useDeferredValue(end)
  let effStart = start < dStart ? dStart : start
  let effEnd = end > dEnd ? dEnd : end

  if (effStart > effEnd || isSticky) {
    effStart = start
    effEnd = end
  }
  if (pendingDelta > 0) {
    effEnd = end
  }

  if (effEnd - effStart > MAX_MOUNTED_ITEMS) {
    const mid = ((offsets[effStart] ?? 0) + (offsets[effEnd] ?? 0)) / 2
    if (scrollTop - listOriginRef.current < mid) {
      effEnd = effStart + MAX_MOUNTED_ITEMS
    } else {
      effStart = effEnd - MAX_MOUNTED_ITEMS
    }
  }

  const listOrigin = listOriginRef.current
  const effTopSpacer = offsets[effStart] ?? 0
  const clampMin = effStart === 0 ? 0 : effTopSpacer + listOrigin
  const clampMax = effEnd === n ? Infinity : Math.max(effTopSpacer, (offsets[effEnd] ?? 0) - viewportH) + listOrigin

  useLayoutEffect(() => {
    if (isSticky) {
      scrollRef.current?.setClampBounds(undefined, undefined)
    } else {
      scrollRef.current?.setClampBounds(clampMin, clampMax)
    }
  })

  useLayoutEffect(() => {
    if (skipMeasurementRef.current) {
      skipMeasurementRef.current = false
      return
    }

    let dirty = false
    for (const [k, el] of itemRefs.current) {
      const h = ports.getElementHeight(el)
      if (heightCache.current.get(k) !== h) {
        heightCache.current.set(k, h)
        dirty = true
      }
    }

    const sEl = spacerRef.current
    if (sEl) {
      const origin = ports.getElementTop(sEl)
      if (listOriginRef.current !== origin) {
        listOriginRef.current = origin
        dirty = true
      }
    }

    if (dirty) offsetVersionRef.current++
  })

  const measureRef = useCallback((key: string) => {
    let cached = refCache.current.get(key)
    if (!cached) {
      cached = (el: HTMLElement | null) => {
        if (el) itemRefs.current.set(key, el)
        else itemRefs.current.delete(key)
      }
      refCache.current.set(key, cached)
    }
    return cached
  }, [])

  const getItemTop = useCallback(
    (i: number) => {
      const key = itemKeys[i] ?? ''
      const el = itemRefs.current.get(key)
      return el ? ports.getElementTop(el) : -1
    },
    [itemKeys, ports],
  )

  const getItemElement = useCallback((i: number) => itemRefs.current.get(itemKeys[i] ?? '') ?? null, [itemKeys])

  const getItemHeight = useCallback((i: number) => heightCache.current.get(itemKeys[i] ?? ''), [itemKeys])

  const scrollToIndex = useCallback(
    (i: number) => {
      if (i < 0 || i >= n) return
      const target = (offsets[i] ?? 0) + listOriginRef.current
      scrollRef.current?.scrollTo(target)
    },
    [n, offsets, scrollRef],
  )

  return {
    range: [effStart, effEnd],
    topSpacer: effTopSpacer,
    bottomSpacer: totalHeight - (offsets[effEnd] ?? 0),
    measureRef,
    spacerRef,
    offsets,
    getItemTop,
    getItemElement,
    getItemHeight,
    scrollToIndex,
  }
}
