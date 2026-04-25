import type { ScrollBoxHandle } from "@liteai/ink"
import { useInput } from "@liteai/ink"
import type React from "react"
import { useRef } from "react"
import { useKeybind } from "../context/keybind"
import { useTuiConfig } from "../context/tui-config"

// ─── Wheel Acceleration ─────────────────────────────────────────────
//
// Ported from the MVP's ScrollKeybindingHandler. Two codepaths:
//
// 1. **Native terminals** (Ghostty, iTerm2, kitty, WezTerm, etc.):
//    Hard-window linear ramp. Events closer than 40ms ramp the multiplier;
//    idle gaps reset to `base` (default 1). Includes encoder bounce detection
//    to distinguish physical mouse wheels from trackpads.
//
// 2. **xterm.js** (VS Code, Cursor, Windsurf integrated terminals):
//    Exponential decay curve. One event per wheel notch (no pre-amplification).
//    Burst detection (\<5ms) avoids amplifying flicks.

// ─── Native path ───
const WHEEL_ACCEL_WINDOW_MS = 40
const WHEEL_ACCEL_STEP = 0.3
const WHEEL_ACCEL_MAX = 6

// Encoder bounce detection
const WHEEL_BOUNCE_GAP_MAX_MS = 200
const WHEEL_MODE_STEP = 15
const WHEEL_MODE_CAP = 15
const WHEEL_MODE_RAMP = 3
const WHEEL_MODE_IDLE_DISENGAGE_MS = 1500

// ─── xterm.js path ───
const WHEEL_DECAY_HALFLIFE_MS = 150
const WHEEL_DECAY_STEP = 5
const WHEEL_BURST_MS = 5
const WHEEL_DECAY_GAP_MS = 80
const WHEEL_DECAY_CAP_SLOW = 3
const WHEEL_DECAY_CAP_FAST = 6
const WHEEL_DECAY_IDLE_MS = 500

type WheelAccelState = {
  time: number
  mult: number
  dir: 0 | 1 | -1
  xtermJs: boolean
  frac: number
  base: number
  pendingFlip: boolean
  wheelMode: boolean
  burstCount: number
}

function initWheelAccel(xtermJs = false, base = 1): WheelAccelState {
  return {
    time: 0,
    mult: base,
    dir: 0,
    xtermJs,
    frac: 0,
    base,
    pendingFlip: false,
    wheelMode: false,
    burstCount: 0,
  }
}

/**
 * Detect xterm.js terminals (VS Code, Cursor, Windsurf) from TERM_PROGRAM.
 * These send fewer wheel events/notch and need a different accel curve.
 */
function detectXtermJs(): boolean {
  const tp = process.env.TERM_PROGRAM
  return tp === "vscode" || tp === "cursor" || tp === "windsurf"
}

/**
 * Read LITEAI_SCROLL_SPEED env, default 1, clamp (0, 20].
 */
function readScrollSpeedBase(): number {
  const raw = process.env.LITEAI_SCROLL_SPEED
  if (!raw) return 1
  const n = parseFloat(raw)
  return Number.isNaN(n) || n <= 0 ? 1 : Math.min(n, 20)
}

/**
 * Compute rows for one wheel event, mutating accel state.
 * Returns 0 when a direction flip is deferred for bounce detection.
 */
function computeWheelStep(state: WheelAccelState, dir: 1 | -1, now: number): number {
  if (!state.xtermJs) {
    // Idle disengage
    if (state.wheelMode && now - state.time > WHEEL_MODE_IDLE_DISENGAGE_MS) {
      state.wheelMode = false
      state.burstCount = 0
      state.mult = state.base
    }

    // Resolve deferred flip
    if (state.pendingFlip) {
      state.pendingFlip = false
      if (dir !== state.dir || now - state.time > WHEEL_BOUNCE_GAP_MAX_MS) {
        // Real reversal or late flip-back
        state.dir = dir
        state.time = now
        state.mult = state.base
        return Math.floor(state.mult)
      }
      // Bounce confirmed
      state.wheelMode = true
    }

    const gap = now - state.time
    if (dir !== state.dir && state.dir !== 0) {
      // Flip — defer for bounce detection
      state.pendingFlip = true
      state.time = now
      return 0
    }
    state.dir = dir
    state.time = now

    // Mouse (wheel mode, sticky until device-switch signal)
    if (state.wheelMode) {
      if (gap < WHEEL_BURST_MS) {
        if (++state.burstCount >= 5) {
          state.wheelMode = false
          state.burstCount = 0
          state.mult = state.base
        } else {
          return 1
        }
      } else {
        state.burstCount = 0
      }
    }
    if (state.wheelMode) {
      const m = 0.5 ** (gap / WHEEL_DECAY_HALFLIFE_MS)
      const cap = Math.max(WHEEL_MODE_CAP, state.base * 2)
      const next = 1 + (state.mult - 1) * m + WHEEL_MODE_STEP * m
      state.mult = Math.min(cap, next, state.mult + WHEEL_MODE_RAMP)
      return Math.floor(state.mult)
    }

    // Trackpad / hi-res (native, non-wheel-mode)
    if (gap > WHEEL_ACCEL_WINDOW_MS) {
      state.mult = state.base
    } else {
      const cap = Math.max(WHEEL_ACCEL_MAX, state.base * 2)
      state.mult = Math.min(cap, state.mult + WHEEL_ACCEL_STEP)
    }
    return Math.floor(state.mult)
  }

  // ─── xterm.js (VS Code, Cursor, Windsurf) ───
  const gap = now - state.time
  const sameDir = dir === state.dir
  state.time = now
  state.dir = dir

  if (sameDir && gap < WHEEL_BURST_MS) return 1
  if (!sameDir || gap > WHEEL_DECAY_IDLE_MS) {
    state.mult = 2
    state.frac = 0
  } else {
    const m = 0.5 ** (gap / WHEEL_DECAY_HALFLIFE_MS)
    const cap = gap >= WHEEL_DECAY_GAP_MS ? WHEEL_DECAY_CAP_SLOW : WHEEL_DECAY_CAP_FAST
    state.mult = Math.min(cap, 1 + (state.mult - 1) * m + WHEEL_DECAY_STEP * m)
  }
  const total = state.mult + state.frac
  const rows = Math.floor(total)
  state.frac = total - rows
  return rows
}

// ─── Scroll Primitives ──────────────────────────────────────────────

/**
 * Keyboard page jump: scrollTo() writes scrollTop directly and clears
 * pendingScrollDelta — one frame, no drain. Target is relative to
 * scrollTop+pendingDelta so a jump mid-wheel-burst lands correctly.
 */
function jumpBy(s: ScrollBoxHandle, delta: number): boolean {
  const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight())
  const target = s.getScrollTop() + s.getPendingDelta() + delta
  if (target >= max) {
    s.scrollTo(max)
    s.scrollToBottom()
    return true
  }
  s.scrollTo(Math.max(0, target))
  return false
}

/**
 * Wheel-down past maxScroll re-enables sticky so wheeling at the bottom
 * naturally re-pins (matches typical chat-app behavior).
 */
function scrollDown(s: ScrollBoxHandle, amount: number): void {
  const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight())
  const effectiveTop = s.getScrollTop() + s.getPendingDelta()
  if (effectiveTop + amount >= max) {
    s.scrollToBottom()
    return
  }
  s.scrollBy(amount)
}

/**
 * Wheel-up past scrollTop=0 clamps via scrollTo(0), clearing
 * pendingScrollDelta so aggressive wheel bursts don't accumulate
 * an unbounded negative delta.
 */
function scrollUp(s: ScrollBoxHandle, amount: number): void {
  const effectiveTop = s.getScrollTop() + s.getPendingDelta()
  if (effectiveTop - amount <= 0) {
    s.scrollTo(0)
    return
  }
  s.scrollBy(-amount)
}

// ─── React Component ────────────────────────────────────────────────

type Props = {
  scrollRef: React.RefObject<ScrollBoxHandle | null>
}

/**
 * Translates keyboard and mouse wheel input events into ScrollBox API
 * calls. Renders nothing — mount alongside a SessionLayout that owns
 * the ScrollBox pointed to by scrollRef.
 *
 * Handles:
 * - Mouse wheel (wheelUp/wheelDown) with acceleration
 * - PageUp/PageDown (configurable via keybinds)
 * - Home/End, Ctrl+Home/Ctrl+End for top/bottom
 * - Half-page and line scroll via keybinds
 */
export function ScrollHandler({ scrollRef }: Props): null {
  const keybind = useKeybind()
  const config = useTuiConfig()

  // Lazy-init wheel acceleration state so TERM_PROGRAM probe has settled
  const wheelAccel = useRef<WheelAccelState | null>(null)

  // Read configured scroll speed (from tui config or env)
  const scrollSpeedRef = useRef<number | null>(null)
  if (scrollSpeedRef.current === null) {
    scrollSpeedRef.current = config.scroll_speed ?? readScrollSpeedBase()
  }

  useInput((_input, key, event) => {
    if (!event) return
    const s = scrollRef.current
    if (!s) return

    // ─── Mouse Wheel ───
    if (key.wheelUp || key.wheelDown) {
      // Skip if content fits in viewport (no need to scroll)
      if (s.getScrollHeight() <= s.getViewportHeight()) return

      if (!wheelAccel.current) {
        const base = scrollSpeedRef.current ?? 1
        wheelAccel.current = initWheelAccel(detectXtermJs(), base)
      }

      const dir: 1 | -1 = key.wheelDown ? 1 : -1
      const step = computeWheelStep(wheelAccel.current, dir, performance.now())
      if (step === 0) return // Deferred bounce detection

      if (dir > 0) {
        scrollDown(s, step)
      } else {
        scrollUp(s, step)
      }
      return
    }

    const kp = event.keypress

    // ─── Keyboard Scroll (via keybinds) ───

    // Page up/down — half viewport
    if (keybind.match("messages_page_up", kp)) {
      const delta = -Math.max(1, Math.floor(s.getViewportHeight() / 2))
      jumpBy(s, delta)
      return
    }
    if (keybind.match("messages_page_down", kp)) {
      const delta = Math.max(1, Math.floor(s.getViewportHeight() / 2))
      jumpBy(s, delta)
      return
    }

    // Half page
    if (keybind.match("messages_half_page_up", kp)) {
      const delta = -Math.max(1, Math.floor(s.getViewportHeight() / 2))
      jumpBy(s, delta)
      return
    }
    if (keybind.match("messages_half_page_down", kp)) {
      const delta = Math.max(1, Math.floor(s.getViewportHeight() / 2))
      jumpBy(s, delta)
      return
    }

    // Line scroll
    if (keybind.match("messages_line_up", kp)) {
      scrollUp(s, 1)
      return
    }
    if (keybind.match("messages_line_down", kp)) {
      scrollDown(s, 1)
      return
    }

    // Top/bottom
    if (keybind.match("messages_first", kp)) {
      s.scrollTo(0)
      return
    }
    if (keybind.match("messages_last", kp)) {
      const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight())
      s.scrollTo(max)
      s.scrollToBottom()
      return
    }
  })

  return null
}
