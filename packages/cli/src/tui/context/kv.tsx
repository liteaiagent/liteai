import path from "node:path"
import { Global } from "@liteai/core/global/index"
import { Fs as Filesystem } from "@liteai/util/fs"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

export interface KV {
  ready: boolean
  store: Record<string, unknown>
  get: (key: string, defaultValue?: unknown) => unknown
  set: (key: string, value: unknown) => void
}

const KVContext = createContext<KV | undefined>(undefined)

export function useKV(): KV {
  const context = useContext(KVContext)
  if (context === undefined) {
    throw new Error("KV context must be used within a context provider")
  }
  return context
}

export function KVProvider({ children }: { children?: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [store, setStore] = useState<Record<string, unknown>>({})
  const filePath = useMemo(() => path.join(Global.Path.state, "kv.json"), [])

  useEffect(() => {
    Filesystem.readJson<Record<string, unknown>>(filePath)
      .then((x) => {
        setStore(x)
      })
      .catch((err: unknown) => {
        // First-run: kv.json may not exist yet. Log but don't throw.
        console.error("[KV] Failed to read store:", err)
      })
      .finally(() => {
        setReady(true)
      })
  }, [filePath])

  const set = useCallback(
    (key: string, value: unknown) => {
      setStore((prev) => {
        const next = { ...prev, [key]: value }
        Filesystem.writeJson(filePath, next)
        return next
      })
    },
    [filePath],
  )

  const get = useCallback(
    (key: string, defaultValue?: unknown) => {
      return store[key] ?? defaultValue
    },
    [store],
  )

  const value = useMemo(
    () => ({
      ready,
      store,
      get,
      set,
    }),
    [ready, store, get, set],
  )

  if (!ready) {
    return null
  }

  return <KVContext.Provider value={value}>{children}</KVContext.Provider>
}
