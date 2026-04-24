type EventMap = Record<string, unknown>
type Handler<T> = (event: T) => void

export interface TypedEmitter<T extends EventMap> {
  on<K extends keyof T>(event: K, handler: Handler<T[K]>): () => void
  emit<K extends keyof T>(event: K, payload: T[K]): void
  off<K extends keyof T>(event: K, handler: Handler<T[K]>): void
}

/**
 * A lightweight, typed event emitter.
 */
export function createEventEmitter<T extends EventMap>(): TypedEmitter<T> {
  // biome-ignore lint/suspicious/noExplicitAny: Internal storage for handlers of varying types
  const handlers = new Map<keyof T, Set<Handler<any>>>()

  return {
    on(event, handler) {
      let set = handlers.get(event)
      if (!set) {
        set = new Set()
        handlers.set(event, set)
      }
      set.add(handler)

      return () => this.off(event, handler)
    },

    emit(event, payload) {
      const set = handlers.get(event)
      if (set) {
        for (const handler of set) {
          handler(payload)
        }
      }
    },

    off(event, handler) {
      const set = handlers.get(event)
      if (set) {
        set.delete(handler)
        if (set.size === 0) {
          handlers.delete(event)
        }
      }
    },
  }
}
