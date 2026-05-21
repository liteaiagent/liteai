/**
 * Module-level prompt ref — replaces PromptRefProvider.
 *
 * PromptRef is an imperative handle (bag of callbacks), not declarative state.
 * The original PromptRefProvider used useRef internally with a stable context
 * value — there was never a React re-render. A module-level singleton is
 * structurally equivalent and eliminates a provider wrapper.
 *
 * @module context/prompt-ref
 */

import type { PromptInfo } from "../types"

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
  /** Populate the input with text (used by message edit action) */
  prefill(text: string): void
}

export type PromptRefContextValue = {
  readonly current: PromptRef | undefined
  set: (ref: PromptRef | undefined) => void
}

// ── Module-level singleton ───────────────────────────────────────────────

const _ref: { current: PromptRef | undefined } = { current: undefined }

/**
 * Module-level prompt ref. Replaces `PromptRefProvider` context.
 *
 * Thread-safe for single-process Node: only one Ink app instance
 * exists at a time. The ref is read imperatively — no React renders
 * are triggered by changes.
 *
 * Limitation: multiple Ink app instances in the same process will share
 * this singleton. If multi-instance support is ever needed, consider
 * replacing with AsyncLocalStorage for per-app isolation.
 */
export const promptRef: PromptRefContextValue = {
  get current() {
    return _ref.current
  },
  set(value: PromptRef | undefined) {
    _ref.current = value
  },
}

/**
 * Hook API — preserves the same call pattern as the old context hook.
 * Returns the module-level singleton (no context needed).
 */
export function usePromptRef(): PromptRefContextValue {
  return promptRef
}
