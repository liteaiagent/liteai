/**
 * ModelController — abstract interface for model management.
 *
 * Provides model listing, visibility, selection, and variant handling
 * without depending on specific provider/sync implementations.
 */
export interface ModelController {
  /** Full list of available models. */
  list(): ModelInfo[]

  /** Find a model by provider+model key. */
  find(key: ModelKey): ModelInfo | undefined

  /** Whether a model is visible (user preference). */
  visible(key: ModelKey): boolean

  /** Set visibility for a model. */
  setVisibility(key: ModelKey, state: boolean): void

  /** Recently used models. */
  recent: {
    list(): ModelKey[]
    push(key: ModelKey): void
  }

  /** Model variant management. */
  variant: {
    get(key: ModelKey): string | undefined
    set(key: ModelKey, value: string | undefined): void
  }

  /** Whether the model list has been populated. */
  ready(): boolean
}

/** Unique identifier for a model. */
export type ModelKey = {
  providerID: string
  modelID: string
}

/** Model info as exposed to components. */
export type ModelInfo = {
  id: string
  name: string
  family: string
  release_date: string
  latest: boolean
  variants?: Record<string, unknown>
  cost?: { input: number; output: number }
  provider: {
    id: string
    name: string
  }
}
