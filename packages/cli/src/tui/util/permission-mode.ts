/**
 * Permission mode constants, cycling logic, and display metadata.
 *
 * Defines the user-facing permission modes that can be cycled via Shift+Tab.
 * Agent-only modes (`dontAsk`, `bubble`) are excluded from the cycle.
 *
 * The cycling order mirrors Claude Code's approach:
 *   default → plan → acceptEdits → bypassPermissions → (wrap)
 *
 * Display metadata (symbol, title, color) follows the TUI theme contract
 * and is consumed by the footer mode indicator and toast notifications.
 *
 * @module tui/util/permission-mode
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** User-cyclable permission modes. */
export type PermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions"

// ── Cycling ──────────────────────────────────────────────────────────────────

/** Ordered cycle for Shift+Tab. Last element wraps to first. */
const PERMISSION_MODE_ORDER: readonly PermissionMode[] = [
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
] as const

/**
 * Pure function: returns the next mode in the cycle.
 * Unknown modes fall back to `"default"`.
 */
export function getNextPermissionMode(current: string): PermissionMode {
  const idx = PERMISSION_MODE_ORDER.indexOf(current as PermissionMode)
  if (idx === -1) return PERMISSION_MODE_ORDER[0]
  return PERMISSION_MODE_ORDER[(idx + 1) % PERMISSION_MODE_ORDER.length]
}

// ── Display Metadata ─────────────────────────────────────────────────────────

const MODE_TITLE: Record<PermissionMode, string> = {
  default: "Default",
  plan: "Plan Mode",
  acceptEdits: "Accept Edits",
  bypassPermissions: "Yolo Mode",
}

const MODE_SYMBOL: Record<PermissionMode, string> = {
  default: "◇",
  plan: "☰",
  acceptEdits: "✎",
  bypassPermissions: "⚡",
}

const MODE_COLOR: Record<PermissionMode, string> = {
  default: "gray",
  plan: "cyan",
  acceptEdits: "yellow",
  bypassPermissions: "red",
}

/** Human-readable title for the mode. */
export function permissionModeTitle(mode: string): string {
  return MODE_TITLE[mode as PermissionMode] ?? MODE_TITLE.default
}

/** Unicode symbol for the mode indicator. */
export function permissionModeSymbol(mode: string): string {
  return MODE_SYMBOL[mode as PermissionMode] ?? MODE_SYMBOL.default
}

/** Theme-aligned color string for the mode indicator. */
export function permissionModeColor(mode: string): string {
  return MODE_COLOR[mode as PermissionMode] ?? MODE_COLOR.default
}

/** Returns true when the mode is `"default"` — indicator should be hidden. */
export function isDefaultMode(mode: string): boolean {
  return mode === "default"
}
