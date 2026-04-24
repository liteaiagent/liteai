type EventMap = Record<string, unknown>
type Handler<T> = (event: T) => void

export interface TypedEmitter<T extends EventMap> {
  on<K extends keyof T>(event: K, handler: Handler<T[K]>): () => void
  on(predicate: (event: T[keyof T]) => boolean, handler: Handler<T[keyof T]>): () => void
  emit<K extends keyof T>(event: K, payload: T[K]): void
  off<K extends keyof T>(event: K, handler: Handler<T[K]>): void
  off(predicate: (event: T[keyof T]) => boolean, handler: Handler<T[keyof T]>): void
}

/**
 * A lightweight, typed event emitter.
 */
export function createEventEmitter<T extends EventMap>(): TypedEmitter<T> {
  const handlers = new Map<keyof T, Set<Handler<unknown>>>()
  const anyHandlers = new Set<{ predicate: (event: T[keyof T]) => boolean; handler: Handler<T[keyof T]> }>()

  const emitter: TypedEmitter<T> = {
    on(eventOrPredicate: keyof T | ((event: T[keyof T]) => boolean), handler: Handler<T[keyof T]>) {
      if (typeof eventOrPredicate === "function") {
        anyHandlers.add({ predicate: eventOrPredicate, handler })
        return () => this.off(eventOrPredicate as (event: T[keyof T]) => boolean, handler)
      }

      let set = handlers.get(eventOrPredicate)
      if (!set) {
        set = new Set()
        handlers.set(eventOrPredicate, set)
      }
      set.add(handler as Handler<unknown>)

      return () => this.off(eventOrPredicate as keyof T, handler as Handler<T[keyof T]>)
    },

    emit(event, payload) {
      const set = handlers.get(event)
      if (set) {
        for (const handler of set) {
          handler(payload)
        }
      }

      for (const { predicate, handler } of anyHandlers) {
        if (predicate(payload as T[keyof T])) {
          handler(payload as T[keyof T])
        }
      }
    },

    off(eventOrPredicate: keyof T | ((event: T[keyof T]) => boolean), handler: Handler<T[keyof T]>) {
      if (typeof eventOrPredicate === "function") {
        for (const item of anyHandlers) {
          if (item.predicate === eventOrPredicate && item.handler === handler) {
            anyHandlers.delete(item)
          }
        }
        return
      }

      const set = handlers.get(eventOrPredicate)
      if (set) {
        set.delete(handler as Handler<unknown>)
        if (set.size === 0) {
          handlers.delete(eventOrPredicate)
        }
      }
    },
  }

  return emitter
}
