import type { Event } from "@liteai/sdk"
import type React from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useArgs } from "../context/args"
import { useExit } from "../context/exit"
import { useSDK } from "../context/sdk"
import { useToast } from "../context/toast"
import { TuiLog } from "../util/tui-log"
import type { AppState } from "./app-state"
import { getDefaultAppState } from "./app-state"
import { bootstrapAction, cleanupSessionAction, syncSessionAction, syncWorkspacesAction } from "./app-state-actions"
import { handleAppStateEvent } from "./app-state-events"
import { type AppStore, createAppStore } from "./app-store"

// ── Context ─────────────────────────────────────────────────────────────

const AppStoreContext = createContext<AppStore<AppState> | undefined>(undefined)

export function useAppStoreContext(): AppStore<AppState> {
  const store = useContext(AppStoreContext)
  if (!store) throw new Error("useAppState must be used within an AppStateProvider")
  return store
}

// ── Consumer Hooks ──────────────────────────────────────────────────────

export function useAppState<R>(selector: (state: AppState) => R): R {
  const store = useAppStoreContext()
  // Store selector in a ref so getSnapshot's identity is stable across renders.
  // Without this, inline arrow selectors (the universal usage pattern) cause
  // useCallback to create a new getSnapshot every render, forcing
  // useSyncExternalStore to re-subscribe — unnecessary churn under high
  // re-render frequency.
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  const getSnapshot = useCallback(() => selectorRef.current(store.getState()), [store])
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

export function useSetAppState(): AppStore<AppState>["setState"] {
  return useAppStoreContext().setState
}

export function useAppStore(): AppStore<AppState> {
  return useAppStoreContext()
}

// ── Actions Hook ────────────────────────────────────────────────────────
// Returns stable functions for actions that need access to the store

export interface AppActions {
  bootstrap: () => Promise<void>
  syncWorkspaces: () => Promise<void>
  session: {
    sync: (sessionID: string) => Promise<void>
    cleanup: (sessionID: string) => void
  }
  workspace: {
    sync: () => Promise<void>
  }
}

export function useAppActions(): AppActions {
  const store = useAppStoreContext()
  const sdk = useSDK()
  const exit = useExit()
  const args = useArgs()
  const fullSyncedSessionsRef = useRef(new Set<string>())

  return useMemo(() => {
    const ctx = {
      setState: store.setState,
      getState: store.getState,
      sdk: sdk.client,
      projectID: sdk.projectID,
      exit,
      args,
    }

    const bootstrap = () => bootstrapAction(ctx)
    const syncWorkspaces = () => syncWorkspacesAction(ctx)

    return {
      bootstrap,
      syncWorkspaces,
      session: {
        sync: (sessionID: string) => syncSessionAction(ctx, sessionID, fullSyncedSessionsRef),
        cleanup: (sessionID: string) => cleanupSessionAction(ctx, sessionID, fullSyncedSessionsRef),
      },
      workspace: {
        sync: syncWorkspaces,
      },
    }
  }, [store, sdk, exit, args])
}

// ── Provider ────────────────────────────────────────────────────────────

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => createAppStore(getDefaultAppState()))
  const sdk = useSDK()
  const exit = useExit()
  const args = useArgs()
  const toast = useToast()
  // Stable reference — toast.show is a useCallback with zero deps, so its
  // identity never changes. Destructuring prevents the SSE reconnection
  // cascade that occurs when onSessionError depends on the full toast object
  // (which re-identifies whenever the toasts array changes).
  const toastShow = toast.show

  // Phase 2: SSE Transport Hardening references
  const sseControllerRef = useRef<AbortController | undefined>(undefined)
  const startedRef = useRef(false)

  const ctx = useMemo(
    () => ({
      setState: store.setState,
      getState: store.getState,
      sdk: sdk.client,
      projectID: sdk.projectID,
      exit,
      args,
    }),
    [store, sdk, exit, args],
  )

  const bootstrap = useCallback(() => bootstrapAction(ctx), [ctx])

  // Session error toast — wired into the event handler via onSessionError
  // Extract descriptive message from NamedError discriminated union shape:
  // { name: "UnknownError", data: { message: "Model not found: ..." } }
  const onSessionError = useCallback(
    (_sessionID: string, error: unknown) => {
      const err = error as { name?: string; data?: { message?: string } } | undefined
      const message = err?.data?.message ?? "Session encountered an error"
      toastShow({ variant: "error", message, duration: 5000 })
    },
    [toastShow],
  )

  // Handle events using pure function
  const handleEvent = useCallback(
    (event: Event) => {
      handleAppStateEvent(event, { ...ctx, sdk: sdk.client, bootstrap, onSessionError })
    },
    [ctx, sdk, bootstrap, onSessionError],
  )

  const startSSE = useCallback(() => {
    if (startedRef.current) return
    startedRef.current = true

    sseControllerRef.current?.abort()
    const ctrl = new AbortController()
    sseControllerRef.current = ctrl

    ;(async () => {
      let backoff = 1000

      while (true) {
        if (ctrl.signal.aborted) break
        try {
          const events = await sdk.client.event.subscribe({ signal: ctrl.signal })

          // Successful connection resets backoff
          backoff = 1000

          for await (const event of events.stream) {
            if (ctrl.signal.aborted) break
            // Extract payload if it's a GlobalEvent, otherwise cast to Event
            const e = ("payload" in event ? event.payload : event) as Event
            handleEvent(e)
          }

          // Stream completed normally, add a small delay before reconnecting
          if (!ctrl.signal.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }
        } catch (err) {
          if (ctrl.signal.aborted) break

          TuiLog.error("SSE connection error", {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          })

          // Exponential backoff on error
          await new Promise((resolve) => setTimeout(resolve, backoff))
          backoff = Math.min(backoff * 2, 30_000) // cap at 30s
        }
      }
      startedRef.current = false
    })()
  }, [sdk, handleEvent])

  useEffect(() => {
    // Run initial bootstrap
    bootstrap()

    const unsub = sdk.event.on(() => true, handleEvent)

    // Fallback if the underlying sdk implementation doesn't automatically subscribe via .events
    startSSE()

    return () => {
      unsub()
      sseControllerRef.current?.abort()
      startedRef.current = false
    }
  }, [bootstrap, handleEvent, startSSE, sdk])

  // Ready gate equivalent to createSimpleContext
  const status = useSyncExternalStore(
    store.subscribe,
    () => store.getState().status,
    () => store.getState().status,
  )
  if (status === "loading") {
    return null
  }

  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>
}
