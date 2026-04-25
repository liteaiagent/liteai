import { createLiteaiClient, type Event } from "@liteai/sdk"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createEventEmitter } from "../util/event-emitter"
import { createSimpleContext } from "./helper"

export type EventSource = {
  on: (handler: (event: Event) => void) => () => void
  setWorkspace?: (workspaceID?: string) => void
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    projectID?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const [workspaceID, setWorkspaceID] = useState<string | undefined>()
    // Bumped on workspace switch to force SDK client recreation (fresh abort controller)
    const [sdkVersion, setSdkVersion] = useState(0)

    // Use refs for values that should persist across renders but don't need to trigger them
    const abortControllerRef = useRef(new AbortController())
    const sseControllerRef = useRef<AbortController | undefined>(undefined)
    const queueRef = useRef<Event[]>([])
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const lastFlushRef = useRef(0)

    const sdk = useMemo(() => {
      // Replace the global abort controller on each SDK recreation
      abortControllerRef.current.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller

      return createLiteaiClient({
        baseUrl: props.url,
        signal: controller.signal,
        fetch: props.fetch,
        headers: props.headers,
      })
      // sdkVersion forces recreation on workspace switch
    }, [props.url, props.fetch, props.headers, sdkVersion])

    const emitter = useMemo(() => {
      return createEventEmitter<{
        [key in Event["type"]]: Extract<Event, { type: key }>
      }>()
    }, [])

    const flush = useCallback(() => {
      if (queueRef.current.length === 0) return
      const events = queueRef.current
      queueRef.current = []
      timerRef.current = undefined
      lastFlushRef.current = Date.now()

      // Batch event emissions
      for (const event of events) {
        emitter.emit(event.type, event)
      }
    }, [emitter])

    const handleEvent = useCallback(
      (event: Event) => {
        queueRef.current.push(event)
        const elapsed = Date.now() - lastFlushRef.current

        if (timerRef.current) return

        if (elapsed < 16) {
          timerRef.current = setTimeout(flush, 16)
          return
        }
        flush()
      },
      [flush],
    )

    const startSSE = useCallback(() => {
      sseControllerRef.current?.abort()
      const ctrl = new AbortController()
      sseControllerRef.current = ctrl

      ;(async () => {
        while (true) {
          if (abortControllerRef.current.signal.aborted || ctrl.signal.aborted) break
          try {
            const events = await sdk.event.subscribe({ signal: ctrl.signal })
            for await (const event of events.stream) {
              if (ctrl.signal.aborted) break
              handleEvent(event as unknown as Event)
            }
          } catch {
            if (ctrl.signal.aborted) break
            // Wait before reconnecting
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }

          if (timerRef.current) clearTimeout(timerRef.current)
          if (queueRef.current.length > 0) flush()
        }
      })()
    }, [sdk, handleEvent, flush])

    useEffect(() => {
      if (props.events) {
        const unsub = props.events.on(handleEvent)
        return unsub
      }

      startSSE()
    }, [props.events, handleEvent, startSSE])

    useEffect(() => {
      return () => {
        abortControllerRef.current.abort()
        sseControllerRef.current?.abort()
        if (timerRef.current) clearTimeout(timerRef.current)
      }
    }, [])

    const result = useMemo(
      () => ({
        get client() {
          return sdk
        },
        get projectID() {
          return workspaceID || props.projectID || props.directory || ""
        },
        directory: props.directory,
        event: emitter,
        fetch: props.fetch ?? fetch,
        setWorkspace(next?: string) {
          if (workspaceID === next) return
          setWorkspaceID(next)
          // Bump version to trigger SDK client recreation (mirrors SolidJS sdk = createSDK())
          setSdkVersion((v) => v + 1)
          props.events?.setWorkspace?.(next)
          if (!props.events) startSSE()
        },
        url: props.url,
      }),
      [sdk, workspaceID, props.projectID, props.directory, emitter, props.fetch, props.events, props.url, startSSE],
    )

    return result
  },
})
