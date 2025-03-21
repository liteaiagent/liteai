/**
 * Eval hooks — lightweight callback system for LLM call instrumentation.
 *
 * Port of liteai/eval_hooks.py
 */

export type EvalEvent = Record<string, unknown>
type EvalHookFn = (event: EvalEvent) => void

const hooks: EvalHookFn[] = []

export function registerHook(callback: EvalHookFn): void {
  hooks.push(callback)
  console.info(`Eval hook registered: ${callback.name || "anonymous"}`)
}

export function unregisterHook(callback: EvalHookFn): void {
  const index = hooks.indexOf(callback)
  if (index !== -1) hooks.splice(index, 1)
}

export function fireHooks(event: EvalEvent): void {
  if (hooks.length === 0) return
  for (const hook of hooks) {
    try {
      hook(event)
    } catch (err) {
      console.warn(`Eval hook ${hook.name || "anonymous"} failed:`, err)
    }
  }
}

export function hasHooks(): boolean {
  return hooks.length > 0
}
