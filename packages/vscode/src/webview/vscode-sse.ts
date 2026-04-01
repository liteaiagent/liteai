import { batch } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"
import { applyEvent, type VscodeState } from "./vscode-store"

const LOG_PREFIX = "[liteai-sse]"

/**
 * Subscribes to Core's project-level SSE event stream via the proxied fetch.
 *
 * Events are parsed and applied to the VscodeStore, driving reactive UI updates.
 * Automatically reconnects on disconnect.
 *
 * @returns cleanup function to stop the subscription
 */
export function createSseSubscription(opts: {
  /** The proxied fetch function from vscodePlatform. */
  fetch: typeof globalThis.fetch
  /** The Core server URL (e.g. http://127.0.0.1:XXXXX). */
  serverUrl: string
  /** The project ID to subscribe to. */
  projectID: string
  /** The reactive store + setter. */
  store: Store<VscodeState>
  set: SetStoreFunction<VscodeState>
}): () => void {
  const controller = new AbortController()
  let active = true

  const RECONNECT_DELAY_MS = 1000
  const BATCH_FRAME_MS = 16

  async function connect() {
    while (active && !controller.signal.aborted) {
      try {
        // Subscribe to the project-level event stream
        const url = `${opts.serverUrl}/project/${opts.projectID}/event`
        const response = await opts.fetch(url, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        })

        if (!response.ok) {
          console.warn(LOG_PREFIX, `Event stream returned ${response.status}, retrying...`)
          await sleep(RECONNECT_DELAY_MS)
          continue
        }

        if (!response.body) {
          console.warn(LOG_PREFIX, "No response body, retrying...")
          await sleep(RECONNECT_DELAY_MS)
          continue
        }

        console.log(LOG_PREFIX, "Connected to event stream")
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let pendingEvents: Array<{ type: string; properties?: unknown }> = []
        let flushTimer: ReturnType<typeof setTimeout> | undefined

        const flushEvents = () => {
          if (pendingEvents.length === 0) return
          const events = pendingEvents
          pendingEvents = []
          flushTimer = undefined

          batch(() => {
            for (const event of events) {
              applyEvent(opts.store, opts.set, event)
            }
          })
        }

        const scheduleFlush = () => {
          if (flushTimer !== undefined) return
          flushTimer = setTimeout(flushEvents, BATCH_FRAME_MS)
        }

        try {
          while (active) {
            const { done, value } = await reader.read()
            if (done) {
              console.log(LOG_PREFIX, "Stream reader done (server closed connection)")
              break
            }

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue
              const json = line.slice(6).trim()
              if (!json) continue

              try {
                const event = JSON.parse(json)
                if (event && typeof event === "object" && event.type) {
                  // Project events come as { type, properties }
                  // Global events come as { directory, payload: { type, properties } }
                  const inner = event.payload ?? event
                  console.log(LOG_PREFIX, "event received:", inner.type, inner)
                  pendingEvents.push(inner)
                  scheduleFlush()
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        } finally {
          if (flushTimer !== undefined) clearTimeout(flushTimer)
          flushEvents() // flush remaining
          reader.releaseLock()
        }
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === "AbortError") return
        console.warn(LOG_PREFIX, "Event stream error, reconnecting...", error)
      }

      if (!active || controller.signal.aborted) return
      await sleep(RECONNECT_DELAY_MS)
    }
  }

  // Start the connection loop
  void connect()

  return () => {
    active = false
    controller.abort()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
