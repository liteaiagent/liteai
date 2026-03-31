import type { Agent } from "@liteai/sdk/client"
import type { ModelInfo, ModelKey } from "./model-controller"

/**
 * SelectionController — abstract interface for model/agent selection state.
 *
 * Components use this to read and change the currently selected agent, model,
 * and variant without depending on `useLocal()` or any specific state backend.
 *
 * The host platform (Web, VSCode) provides an implementation:
 * - Web: wraps `useLocal()` from the existing sync/sdk infrastructure
 * - VSCode: manages selection via postMessage IPC to the Extension Host
 */
export interface SelectionController {
  agent: {
    /** Currently selected agent. */
    current(): Agent | undefined
    /** Available (non-hidden, non-subagent) agents. */
    list(): Agent[]
    /** Change the selected agent by name. */
    set(name: string | undefined): void
  }

  model: {
    /** Currently selected model info. */
    current(): ModelInfo | undefined
    /** All available models. */
    list(): ModelInfo[]
    /** Whether a model is visible (user preference). */
    visible(key: ModelKey): boolean
    /** Change the selected model. */
    set(key: ModelKey | undefined, options?: { recent?: boolean }): void

    variant: {
      /** Currently resolved variant. */
      current(): string | undefined
      /** Available variants for the selected model. */
      list(): string[]
      /** Change the variant. */
      set(value: string | undefined): void
    }
  }
}
