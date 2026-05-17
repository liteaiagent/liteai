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

import { PermissionModeCyclable } from "@liteai/core/session/schema"

/** User-cyclable permission modes. */
export type PermissionMode = PermissionModeCyclable

// ── Cycling ──────────────────────────────────────────────────────────────────

/** Ordered cycle for Shift+Tab. Last element wraps to first. */
const PERMISSION_MODE_ORDER: readonly PermissionMode[] = PermissionModeCyclable.options

/**
 * Pure function: returns the next mode in the cycle.
 * Unknown modes—including agent-only modes like "dontAsk" and "bubble"—will be 
 * treated as unknown and thus fall back to "default" (PERMISSION_MODE_ORDER[0]).
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
  if (mode in MODE_TITLE) return MODE_TITLE[mode as PermissionMode]
  return "Automated Agent"
}

/** Unicode symbol for the mode indicator. */
export function permissionModeSymbol(mode: string): string {
  if (mode in MODE_SYMBOL) return MODE_SYMBOL[mode as PermissionMode]
  return "⚙"
}

/** Theme-aligned color string for the mode indicator. */
export function permissionModeColor(mode: string): string {
  if (mode in MODE_COLOR) return MODE_COLOR[mode as PermissionMode]
  return "magenta"
}

/** Returns true when the mode is `"default"` — indicator should be hidden. */
export function isDefaultMode(mode: string): boolean {
  return mode === "default"
}
