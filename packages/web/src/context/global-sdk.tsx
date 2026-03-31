import type { Event } from "@liteai/sdk/client"
import { createSimpleContext } from "@liteai/ui/context"
import { usePlatform } from "@liteai/ui/panes"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, createEffect, createMemo, on, onCleanup } from "solid-js"
import z from "zod"
import { useServer } from "./server"
import { createSdkForServer } from "./server-util"

const abortError = z.object({
  name: z.literal("AbortError"),
})

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  gate: false,
  init: () => {
    const server = useServer()
    const platform = usePlatform()
    const abort = new AbortController()

    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    type Queued = { directory: string; payload: Event }
    const FLUSH_FRAME_MS = 16
    const STREAM_YIELD_MS = 8
    const RECONNECT_DELAY_MS = 250

    let queue: Queued[] = []
    let buffer: Queued[] = []
    const coalesced = new Map<string, number>()
    const staleDeltas = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0

    const deltaKey = (directory: string, messageID: string, partID: string) => `${directory}:${messageID}:${partID}`

    const key = (directory: string, payload: Event) => {
      if (payload.type === "session.status") return `session.status:${directory}:${payload.properties.sessionID}`
      if (payload.type === "lsp.updated") return `lsp.updated:${directory}`
      if (payload.type === "message.part.updated") {
        const part = payload.properties.part
        return `message.part.updated:${directory}:${part.messageID}:${part.id}`
      }
    }

    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = undefined

      if (queue.length === 0) return

      const events = queue
      const skip = staleDeltas.size > 0 ? new Set(staleDeltas) : undefined
      queue = buffer
      buffer = events
      queue.length = 0
      coalesced.clear()
      staleDeltas.clear()

      last = Date.now()
      batch(() => {
        for (const event of events) {
          if (skip && event.payload.type === "message.part.delta") {
            const props = event.payload.properties
            if (skip.has(deltaKey(event.directory, props.messageID, props.partID))) continue
          }
          emitter.emit(event.directory, event.payload)
        }
      })

      buffer.length = 0
    }

    const schedule = () => {
      if (timer) return
      const elapsed = Date.now() - last
      timer = setTimeout(flush, Math.max(0, FLUSH_FRAME_MS - elapsed))
    }

    let streamErrorLogged = false
    let hasConnected = false
    const waitMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    const aborted = (error: unknown) => abortError.safeParse(error).success

    let attempt: AbortController | undefined
    const HEARTBEAT_TIMEOUT_MS = 15_000
    let lastEventAt = Date.now()
    let heartbeat: ReturnType<typeof setTimeout> | undefined
    const resetHeartbeat = () => {
      lastEventAt = Date.now()
      if (heartbeat) clearTimeout(heartbeat)
      heartbeat = setTimeout(() => {
        attempt?.abort()
      }, HEARTBEAT_TIMEOUT_MS)
    }
    const clearHeartbeat = () => {
      if (!heartbeat) return
      clearTimeout(heartbeat)
      heartbeat = undefined
    }

    // Reactive: start/stop SSE loop when server becomes available/unavailable
    let sseAbort: AbortController | undefined
    createEffect(
      on(
        () => server.current,
        (currentServer) => {
          // Tear down previous SSE loop if server changed
          sseAbort?.abort()
          if (!currentServer) return

          const eventFetch = (() => {
            if (!platform.fetch) return
            try {
              const url = new URL(currentServer.http.url)
              const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
              if (url.protocol === "http:" && !loopback) return platform.fetch
            } catch {
              return
            }
          })()

          const eventSdk = createSdkForServer({
            signal: abort.signal,
            fetch: eventFetch,
            server: currentServer.http,
          })

          const loopAbort = new AbortController()
          sseAbort = loopAbort

          const combined = new AbortController()
          const onOuterAbort = () => combined.abort()
          const onLoopAbort = () => combined.abort()
          abort.signal.addEventListener("abort", onOuterAbort)
          loopAbort.signal.addEventListener("abort", onLoopAbort)

          void (async () => {
            while (!combined.signal.aborted) {
              attempt = new AbortController()
              lastEventAt = Date.now()
              const onCombinedAbort = () => {
                attempt?.abort()
              }
              combined.signal.addEventListener("abort", onCombinedAbort)
              try {
                const events = await eventSdk.event.subscribe({
                  signal: attempt.signal,
                  onSseError: (error: unknown) => {
                    if (aborted(error)) return
                    if (!hasConnected) return
                    if (streamErrorLogged) return
                    streamErrorLogged = true
                    console.error("[global-sdk] event stream error", {
                      url: currentServer.http.url,
                      fetch: eventFetch ? "platform" : "webview",
                      error,
                    })
                  },
                })
                let yielded = Date.now()
                resetHeartbeat()
                for await (const event of events.stream) {
                  resetHeartbeat()
                  hasConnected = true
                  streamErrorLogged = false
                  const directory = event.directory ?? "global"
                  const payload = event.payload
                  const k = key(directory, payload)
                  if (k) {
                    const i = coalesced.get(k)
                    if (i !== undefined) {
                      queue[i] = { directory, payload }
                      if (payload.type === "message.part.updated") {
                        const part = payload.properties.part
                        staleDeltas.add(deltaKey(directory, part.messageID, part.id))
                      }
                      continue
                    }
                    coalesced.set(k, queue.length)
                  }
                  queue.push({ directory, payload })
                  schedule()

                  if (Date.now() - yielded < STREAM_YIELD_MS) continue
                  yielded = Date.now()
                  await waitMs(0)
                }
              } catch (error) {
                if (!aborted(error) && hasConnected && !streamErrorLogged) {
                  streamErrorLogged = true
                  console.error("[global-sdk] event stream failed", {
                    url: currentServer.http.url,
                    fetch: eventFetch ? "platform" : "webview",
                    error,
                  })
                }
              } finally {
                combined.signal.removeEventListener("abort", onCombinedAbort)
                attempt = undefined
                clearHeartbeat()
              }

              if (combined.signal.aborted) return
              await waitMs(RECONNECT_DELAY_MS)
            }
          })().finally(() => {
            abort.signal.removeEventListener("abort", onOuterAbort)
            loopAbort.signal.removeEventListener("abort", onLoopAbort)
            flush()
          })

          onCleanup(() => {
            loopAbort.abort()
          })
        },
      ),
    )

    const onVisibility = () => {
      if (typeof document === "undefined") return
      if (document.visibilityState !== "visible") return
      if (Date.now() - lastEventAt < HEARTBEAT_TIMEOUT_MS) return
      attempt?.abort()
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility)
    }

    onCleanup(() => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility)
      }
      sseAbort?.abort()
      abort.abort()
      flush()
    })

    const url = createMemo(() => server.current?.http.url ?? "")

    const sdk = createMemo(() => {
      const s = server.current
      if (!s) return undefined
      return createSdkForServer({
        server: s.http,
        fetch: platform.fetch,
        throwOnError: true,
      })
    })

    return {
      get url() {
        return url()
      },
      get client() {
        const s = sdk()
        if (!s) throw new Error("Server not available")
        return s
      },
      get connected() {
        return !!server.current
      },
      event: emitter,
      createClient(opts: Omit<Parameters<typeof createSdkForServer>[0], "server" | "fetch">) {
        const s = server.current
        if (!s) throw new Error("Server not available")
        return createSdkForServer({
          server: s.http,
          fetch: platform.fetch,
          ...opts,
        })
      },
    }
  },
})
